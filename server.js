import https from 'https';
import http from 'http';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Server } from 'socket.io';
import { fileTypeFromBuffer } from 'file-type';
import { writeFile, readFile, createWriteStream, existsSync, mkdirSync, readFileSync, unlink } from 'fs';
import util from 'util';
import cors from 'cors';
import multer from 'multer'; // Add multer for handling file uploads
import crypto from 'crypto';
import auth from 'http-auth';
import { readdir } from 'fs/promises';
import dotenv from 'dotenv';
dotenv.config();


const app = express();
app.use(cors());
const __dirname = dirname(fileURLToPath(import.meta.url));

const basicAuth = auth.basic({
    realm: "Admin Area",
    file: __dirname + "/users.htpasswd" // Path to htpasswd file with credentials
});

// Middleware to check if route is /admin and apply auth
app.use("/admin", (req, res, next) => {
    basicAuth.check((req, res) => {
        next();
    })(req, res);
});

// Set up multer for file uploads
const upload = multer({ storage: multer.memoryStorage() }); // Store files in memory for easier access

// Server setup (HTTP or HTTPS)
let arg = process.argv[2];
const server = arg === "http" ? http.createServer(app) : https.createServer({
    key: readFileSync(process.env.privkeypath),
    cert: readFileSync(process.env.certpath)
}, app);

const io = new Server(server, { maxHttpBufferSize: 5e7 });

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

// THIS FUNCTION IS ONLY FOR CURL BASED REQUESTS
app.post('/', upload.single('file'), async (req, res) => {
    try {
        const userip = req.socket.remoteAddress

        const file = req.file.buffer; // Get the file buffer from multer
        logToFile(file); // Log the file buffer
        if (!file) {
            logToFile("failure: file not found");
            return res.status(400).json({ message: "failure: file not found", status: "failure" });
        }
        //get hash of file
        const hash = crypto.createHash('sha256').update(file).digest('hex');
        logToFile(hash);

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
            obj.push({ id: filename, date: new Date(), userip: userip, filehash: hash });
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

// Socket.io connection
io.on('connection', async function (socket) {
    logToFile('A user connected');

    socket.on("upload", (data, callback) => {
        logToFile("Upload initiated");

        // Check for file and IP address in the data object
        if (!data.file || !data.ip) {
            logToFile("Failure: file or IP not found");
            return callback({ message: "Failure: file or IP not found", status: "failure" });
        }

        // Pass both the file buffer and IP address to fileUpload
        fileUpload(data.file, data.ip, callback);
    });
    socket.on("getData", (data, callback) => {
        getAdminData(data, callback);
    })

    socket.on("deleteFile", (data, callback) => {
        deleteFile(data, callback);
    })
});

// Update fileUpload function to handle both file and IP
async function fileUpload(file, ip, callback) {
    logToFile(`IP: ${ip}`); // Log the IP

    if (file == null) {
        logToFile("Failure: file not found");
        return callback({ message: "Failure: file not found", status: "failure" });
    }

    let fileType = await fileTypeFromBuffer(file);
    if (!fileType) {
        logToFile("Failure: file type not found, using .txt");
        fileType = { ext: "txt" };
    }

    let filename = randomString(4) + "." + fileType.ext;
    let fileExists = await checkIfFileExists(filename);
    let counter = 0;

    while (fileExists) {
        filename = randomString(4) + "." + fileType.ext;
        fileExists = await checkIfFileExists(filename);
        counter++;
        if (counter > 5) {
            logToFile("Failure: file already exists");
            return callback({ message: "Failure: file already exists", status: "failure" });
        }
    }

    //get file hash
    const hash = crypto.createHash('sha256').update(file).digest('hex');
    logToFile(hash);

    // Read data.json and add new entry with file ID and date
    readFile('./data.json', 'utf8', (err, data) => {
        if (err) logToFile(err);
        let obj = JSON.parse(data);
        obj.push({ id: filename, date: new Date(), userip: ip, filehash: hash }); // Add IP field if desired
        writeFile('./data.json', JSON.stringify(obj), (err) => {
            if (err) logToFile(err);
        });
    });

    // Save the file to disk
    writeFile(`./files/${filename}`, file, (err) => {
        if (err) logToFile(err);
        callback({ message: err ? "failure" : "success", filename: filename });
    });
}



// /admin path with http-auth
app.get('/admin', (req, res) => {
    res.sendFile(join(__dirname, 'admin.html'));
});

async function getAdminData(data, callback) {
    try {
        const result = await checkFilesInDirectory();
        callback({ message: "success", status: "success", resData: result });
    } catch (err) {
        logToFile(err);
        callback({ message: "failure", status: "failure" });
    }
}

async function checkFilesInDirectory() {
    try {
        let jsonData = await readJSONFile();

        // Read files from the './files/' directory
        const filesInDirectory = await readdir(join(__dirname, '/files/'));

        // Create a result array to store only files found in the directory
        const result = [];

        // Check each entry in the jsonData against the files in the directory
        jsonData.forEach(item => {
            if (filesInDirectory.includes(item.id)) {
                // If the file exists in the directory, add the item to the result array
                result.push(item);
            }
            // If the file does not exist, you can choose to ignore or do something else
        });

        return result;
    } catch (error) {
        console.error('Error reading directory:', error);
    }
}

async function readJSONFile() {
    try {
        const data = await readFileSync('./data.json', 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading JSON file:', error);
        return [];
    }
}

async function deleteFile(data, callback) {
    try {
        const filename = data;
        logToFile("deleting + " + filename)
        const filePath = join(__dirname, '/files/', filename);
        console.log(filePath)
        unlink(filePath, (err) => {
            if (err) callback({ message: "failure", status: "failure" });
            console.log(`${filePath} deleted successfully.`);
        }); callback({ message: "success", status: 200 });
    }
    catch {
        callback({ message: "failure", status: "failure" });
    }

}

