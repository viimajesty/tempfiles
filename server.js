import https from 'https';
import http from 'http';
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Server } from 'socket.io';
import { fileTypeFromBuffer } from 'file-type';
import { writeFile, readFile, createWriteStream, existsSync, mkdirSync, readFileSync, unlink, writeFileSync } from 'fs';
import cors from 'cors';
import multer from 'multer'; // Add multer for handling file uploads
import crypto from 'crypto';
import auth from 'http-auth';
import { readdir } from 'fs/promises';
import dotenv from 'dotenv';
import { getAdminData, deleteFile, preserveFile, deletePreserve, logToFile } from './admin.js';
import { getClientIp } from 'request-ip';
dotenv.config();
let baseurl = process.env.baseurl || "http://localhost:3001/";

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

//start ip 

const ipMiddleware = function (req, _res, next) {
    req.ipInfo = getClientIp(req);
    next();
};

app.use(ipMiddleware);

app.get("/getip", (req, res) => {
    res.json({ ip: req.ipInfo });
})
//end ip

//send current logged in user to client
app.get("/getuser", basicAuth.check((req, res) => {
    res.json({ username: req.user });
}));

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


//url config
const urlStoragePath = join(__dirname, 'urls.json');

// Function to load existing URLs from the JSON file
const loadUrls = () => {
    if (existsSync(urlStoragePath)) {
        const data = readFileSync(urlStoragePath);
        return JSON.parse(data);
    }
    return {};
};

// Function to save URLs to the JSON file
const saveUrls = (urls) => {
    writeFileSync(urlStoragePath, JSON.stringify(urls, null, 2));
};
//end url config



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
} if (!existsSync('./preserve.txt')) {
    writeFile('./preserve.txt', '[]', (err) => {
        if (err) logToFile(err);
    });
}

//initialize length
let numOfFiles = 0;
function updateNum() {
    numOfFiles = JSON.parse(readFileSync('./data.json')).length;
}
updateNum()

//PATHS DEFINE
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(join(__dirname, 'admin.html'));
});

app.use(express.static(join(__dirname, 'files')));

const upload = multer({ storage: multer.memoryStorage() }); // Store files in memory for easier access
// THIS FUNCTION IS ONLY FOR CURL BASED REQUESTS
app.post('/', upload.single('file'), async (req, res) => {
    try {
        const userip = req.socket.remoteAddress

        const file0 = req.file; // Get the file buffer from multer
        const url = req.body.url;
        let file;
        logToFile(file0); // Log the file buffer
        if (!file0 && url) {
            console.log(url);
            //shorten url
            const originalUrl = url;
            const uniqueKey = Math.random().toString(36).substring(2, 8); // Generate a unique key

            // Load existing URLs and add the new one
            const urls = loadUrls();
            urls[uniqueKey] = originalUrl;
            saveUrls(urls);

            return res.status(200).json({ shortLink: baseurl + uniqueKey, status: "success" });

            return;
        } else if (!file0) {
            logToFile("failure: file not found");
            return res.status(400).json({ message: "failure: file not found", status: "failure" });
        } else {
            file = file0.buffer;
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
            obj.push({ id: filename, date: new Date(), userip: userip, filehash: hash, method: "curl" });
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
            res.json({ message: "success", filename: `${baseurl}${filename}` });
        });
        updateNum();
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
    socket.on("preserveFile", (data, callback) => {
        preserveFile(data, callback);
    })
    socket.on("deletePreserve", (data, callback) => {
        deletePreserve(data, callback);
    })

    socket.on("getNumOfFiles", (data, callback) => {
        callback({ numOfFiles: numOfFiles });
    })
});

// FOR WEB BASED UPLOADS
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
        obj.push({ id: filename, date: new Date(), userip: ip, filehash: hash, method: "web" }); // Add IP field if desired
        writeFile('./data.json', JSON.stringify(obj), (err) => {
            if (err) logToFile(err);
        });
    });

    // Save the file to disk
    writeFile(`./files/${filename}`, file, (err) => {
        if (err) logToFile(err);
        callback({ message: err ? "failure" : "success", filename: filename });
    });
    updateNum();
}



app.get('*', function (req, res) {
    const key = req.url.split("/")[1];
    const urls = loadUrls();

    if (urls[key]) {
        res.redirect(urls[key]); // Redirect to the original URL
    } else {
        res.status(404).send('Requested URL not found.');
    }

});
