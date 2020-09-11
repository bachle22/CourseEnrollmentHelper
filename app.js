const fs = require('fs');
const request = require('request');
const cheerio = require('cheerio');
const ora = require('ora');
const { exit } = require('process');
const math = require('mathjs-expression-parser');
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

var $;
var url = 'https://dkhp.uit.edu.vn';
var file = process.env.FILE_PATH ? process.env.FILE_PATH : 'courses.txt';
var studentID = process.env.STUDENT_ID ? process.env.STUDENT_ID : 'YOUR_STUDENT_ID_HERE';
var credential = process.env.CREDENTIAL ? process.env.CREDENTIAL : '';
var coursesList = process.env.COURSES_LIST ? process.env.COURSES_LIST.split(' ') : [];
var settings = {
    check_interval: 30000,
    enroll_interval: 5000,
    retries: 10,
}

var tableFormattedList;
var formCoursesList = {};
var enrollmentDetail = {
    captcha_sid: '',
    captcha_token: '',
    captcha_response: '',
    txtmasv: studentID,
    op: 'Đăng ký',
    form_build_id: '',
    form_token: '',
    form_id: 'uit_dkhp_dangky_form'
}

var httpRequestTemplate = {
    url: url,
    gzip: true,
    headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': '',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15',
        'Accept-Language': 'en-us',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive'
    }
}
var throbber = new ora();
var timeout = ms => new Promise(res => setTimeout(res, ms));

async function setCredential() {
    console.log('Please solve the captcha and login, then enter the credential.')
    return new Promise((resolve, reject) => {
        rl.question('Enter your credential: ', (input) => {
            rl.close();
            let isCredentialValid = checkCredential(input)
                .catch((err) => reject(err))
                .then(() => {
                    if (input && isCredentialValid) resolve(input);
                });
        });
    });
}

async function checkCredential(credential) {
    let checkCredentialRequest = Object.create(httpRequestTemplate);
    checkCredentialRequest.headers.Cookie = credential;
    return new Promise((resolve, reject) => {
        request.get(checkCredentialRequest, (err, res) => {
            if (err) reject(err);
            res.req.path === '/user' ? resolve(true) : reject(new Error('Invalid credential!'));
        })
    })
}

function getCourseList(file) {
    try {
        if (!Array.isArray(coursesList) || !coursesList.length)
            coursesList = fs.readFileSync(file).toString()
            .replace(/\r|\r/g, '').split('\n').filter(Boolean);
        tableFormattedList = coursesList.map(i => 'table_lophoc[' + i).map(i => i + ']');
        formCoursesList = {};
        tableFormattedList.forEach((key, i) => formCoursesList[key] = coursesList[i]);
        return coursesList;
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.log(`No such file or directory: ${file}`);
        } else {
            console.log(err.message);
        }
        return exit(-1);
    }
}

async function getCourseStatus(credential) {
    let getCourseRequest = Object.create(httpRequestTemplate);
    getCourseRequest.headers.Cookie = credential;
    getCourseRequest.url = url + '/sinhvien/hocphan/dangky';
    await timeout(settings.check_interval);
    return new Promise((resolve, reject) => {
        request.get(getCourseRequest, (err, res, body) => {
            switch (res.statusCode) {
                case 200:
                    throbber.text = 'Finding your slot';
                    break;
                case 503:
                    throbber.text = 'Server is down';
                    break;
                case 403:
                    throbber.text = 'Session is either ended or has not started';
                    break;
                default:
                    reject(new Error('Error: ' + res.statusCode));
            }
            if (err) reject(err);
            else {
                $ = cheerio.load(body);
                enrollmentDetail.captcha_response = math.eval($('span.field-prefix').text().replace('=', ''));
                enrollmentDetail.captcha_sid = $('input[name=captcha_sid]').attr('value');
                enrollmentDetail.captcha_token = $('input[name=captcha_token]').attr('value');
                enrollmentDetail.form_build_id = $('input[name=form_build_id]').attr('value');
                enrollmentDetail.form_token = $('input[name=form_token]').attr('value');
                resolve(tableFormattedList.reduce((r, v) => body.toLowerCase().includes(v.toLowerCase()) || r, false));
            }
        })
    })
}

async function enroll(credential) {
    Object.assign(enrollmentDetail, formCoursesList);
    let enrolmentRequest = Object.create(httpRequestTemplate);
    enrolmentRequest.url = url + '/sinhvien/hocphan/dangky';
    enrolmentRequest.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    enrolmentRequest['formData'] = enrollmentDetail;
    return new Promise((resolve, reject) => {
        request.post(enrolmentRequest, (err, res) => {
            if (err) reject(err);
            else resolve(res.statusCode);
        })
    })
}

async function app() {
    getCourseList(file);

    if (!credential) credential = await setCredential().catch((err) => {
        throbber.stopAndPersist({
            symbol: '💥 ',
            text: err.message
        });
        exit(-1);
    });

    console.clear()
    console.log('Courses to enroll: ')
    console.table(coursesList);
    console.log(' ');

    let isEnrollable;
    throbber.spinner = 'clock';
    throbber.start();
    while (!isEnrollable) {
        isEnrollable = await getCourseStatus(credential).catch((err) => {
            throbber.stopAndPersist({ text: `💥  ${err.message}` });
            exit(-1);
        });
    }
    throbber.stopAndPersist({
        symbol: '🎰 ',
        text: 'Found a slot!',
    });

    let i = 0;
    let httpResponseCode = 0;
    throbber.spinner = 'monkey';
    throbber.start();
    let repeater = setInterval(async function() {
        i++;
        httpResponseCode = await enroll(credential);
        throbber.text = `Trying to enroll (${i})`;
        if (i > settings.retries) {
            throbber.stopAndPersist({ symbol: '🙈 ' });
            console.log('🤯  Too many attempt! Exiting...');
            return clearInterval(repeater);
        }
        if (httpResponseCode === 200) {
            throbber.stopAndPersist({ symbol: '🙈 ' });
            console.log('😒  Invalid course enrollment details! Check your courses list.');
            return clearInterval(repeater);
        }
        if (httpResponseCode === 302) {
            throbber.stopAndPersist({ symbol: '🙈 ' });
            console.log('😎  SUCCESS!');
            return clearInterval(repeater);
        }
    }, settings.enroll_interval)
}

app();
