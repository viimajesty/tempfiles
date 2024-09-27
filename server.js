import https from 'https';
import http from 'http';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Server } from 'socket.io';
import { fileTypeFromBuffer } from 'file-type';
import { writeFile, readFile, createWriteStream, existsSync, mkdirSync } from 'fs';
import util from 'util';
import cors from 'cors';
import { readFileSync } from 'fs';
import multer from 'multer'; // Add multer for handling file uploads

const app = express();
app.use(cors());

// Set up multer for file uploads
const upload = multer({ storage: multer.memoryStorage() }); // Store files in memory for easier access

// Server setup (HTTP or HTTPS)
let arg = process.argv[2];
const server = arg === "http" ? http.createServer(app) : https.createServer({
    key: readFileSync('/etc/letsencrypt/live/oracle.vivekkadre.com/privkey.pem'),
    cert: readFileSync('/etc/letsencrypt/live/oracle.vivekkadre.com/cert.pem')
}, app);

const io = new Server(server, { maxHttpBufferSize: 5e7 });
const __dirname = dirname(fileURLToPath(import.meta.url));

server.listen(3001, () => {
    console.log('server running at https://localhost:3001');
});

// Log function
var log_file = createWriteStream('./debug.log', { flags: 'a' });
var log_stdout = process.stdout;

function logToFile(d) {
    var now = new Date();
    var datetime = now.toLocaleString();
    log_file.write(datetime + ' ' + util.format(d) + '\n');
    log_stdout.write(util.format(d) + '\n');
}

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

if (!existsSync('./data.json')) {
    writeFile('./data.json', '[]', (err) => {
        if (err) logToFile(err);
    });
}

// Route to serve the homepage
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});

// Serve static files from the "files" directory
app.use(express.static(join(__dirname, 'files')));

// Socket.io connection
io.on('connection', async function (socket) {
    logToFile('a user connected');
    socket.on("upload", (file, callback) => {
        logToFile("upload initiated");
        fileUpload(file, callback);
    });
});

// Handle file uploads via curl or any form upload
app.post('/', upload.single('file'), async (req, res) => {
    try {
        const file = req.file.buffer; // Get the file buffer from multer
        logToFile(file); // Log the file buffer
        if (!file) {
            logToFile("failure: file not found");
            return res.status(400).json({ message: "failure: file not found", status: "failure" });
        }

        let fileType = await fileTypeFromBuffer(file);
        if (!fileType) {
            logToFile("failure: file type not found, using .txt");
            fileType = { ext: "txt" };
        }
        logToFile(fileType);

        let filename = randomString(4) + "." + fileType.ext;
        let fileExists = await checkIfFileExists(filename);
        let counter = 0;
        while (fileExists) {
            filename = randomString(4);
            fileExists = await checkIfFileExists(filename);
            counter++;
            if (counter > 5) {
                logToFile("failure: file already exists");
                return res.status(500).json({ message: "failure: file already exists", status: "failure" });
            }
        }

        // Update data.json with new entry
        readFile('./data.json', 'utf8', (err, data) => {
            if (err) logToFile(err);
            let obj = JSON.parse(data);
            obj.push({ id: filename, date: new Date() });
            writeFile('./data.json', JSON.stringify(obj), (err) => {
                if (err) logToFile(err);
            });
        });

        // Save the file to disk
        writeFile(`./files/${filename}`, file, (err) => {
            if (err) {
                logToFile(err);
                return res.status(500).json({ message: "failure", status: "failure" });
            }
            res.json({ message: "success", filename: filename });
        });
    } catch (err) {
        logToFile(err);
        res.status(500).json({ message: "failure", status: "failure" });
    }
});

// Helper function to check if file exists
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