import https from 'https';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Server } from 'socket.io';
import { fileTypeFromBuffer } from 'file-type';
import { writeFile, readFile, createWriteStream, existsSync, mkdirSync } from 'fs';
import util from 'util';
import cors from 'cors';
import { readFileSync } from 'fs';

const app = express();
app.use(cors());

const server = https.createServer({
    key: readFileSync('./privkey.pem'),
    cert: readFileSync('./cert.pem')
}, app);

const io = new Server(server, { maxHttpBufferSize: 5e7 });
const __dirname = dirname(fileURLToPath(import.meta.url));

server.listen(3001, () => {
    console.log('server running at https://localhost:3001');
});




//functions
//START LOG FUNCTION
var log_file = createWriteStream('./debug.log', { flags: 'a' }); // Set the flags to 'a' to append to the file
var log_stdout = process.stdout;

function logToFile(d) {
    var now = new Date();
    var datetime = now.toLocaleString();
    log_file.write(datetime + ' ' + util.format(d) + '\n'); // Append the date and time to the log data
    log_stdout.write(util.format(d) + '\n');
}
//END LOG FUNCTION
function randomString(length) {
    const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var result = '';
    for (var i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}

var dir = './files';
if (!existsSync(dir)) {
    mkdirSync(dir);
}
//check if data.json exists, if it does not then create it and put "[]" inside the file
if (!existsSync('./data.json')) {
    writeFile('./data.json', '[]', (err) => {
        if (err) logToFile(err);
    });
}

//end functions

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});
//get /filename
app.get("/*", (req, res) => {
    res.sendFile(__dirname + '/files/' + req.url.replace('/', ''));
});

app.use(express.static(join(__dirname, 'files')))

io.on('connection', async function (socket) {
    logToFile('a user connected');
    socket.on("upload", (file, callback) => {
        logToFile("upload initiated");
        fileUpload(file, callback);
    });
});

async function fileUpload(file, callback) {
    logToFile(file); // <Buffer 25 50 44 ...>
    if (file == null) {
        logToFile("failure: file not found");
        return callback({ message: "failure: file not found", status: "failure" });
    }
    let fileType = await fileTypeFromBuffer(file);
    if (fileType == null) {
        logToFile("failure: file type not found, using .txt");
        fileType = { ext: "txt" };
        //return callback({ message: "failure: file type not found", status: "failure" });
    }
    logToFile(fileType)
    let filename = randomString(4) + "." + fileType.ext;
    let fileExists = await checkIfFileExists(filename);
    let counter = 0;
    while (fileExists) {
        filename = randomString(4);
        fileExists = await checkIfFileExists(filename);
        counter++;
        if (counter > 5) {
            logToFile("failure: file already exists");
            return callback({ message: "failure: file already exists", status: "failure" });
        }
    }

    //read data.json and add new entry
    readFile('./data.json', 'utf8', (err, data) => {
        if (err) logToFile(err);
        let obj = JSON.parse(data);
        obj.push({ id: filename, date: new Date() });
        writeFile('./data.json', JSON.stringify(obj), (err) => {
            if (err) logToFile(err);
        });
    });

    // save the content to the disk
    writeFile(`./files/${filename}`, file, (err) => {
        if (err) logToFile(err);
        callback({ message: err ? "failure" : "success", filename: filename });
    });
}

function checkIfFileExists(filename) {
    return new Promise((resolve, reject) => {
        readFile('./data.json', 'utf8', (err, data) => {
            if (err) {
                reject(err);
                return;
            }
            let obj = JSON.parse(data);
            resolve(obj.some(item => item.id === filename));
        });
    });
}