const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// SQL SERVER
const config = {
    user: 'sa', 
    password: 'Rolands123!',
    server: 'ACERASPIRE15\\SQLEXPRESS',
    database: 'rolands_db',
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

// CONNECT
sql.connect(config).then(() => {
    console.log("Connected to SQL Server");
}).catch(err => console.log(err));

/* LOGIN */
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        let pool = await sql.connect(config);

        // 1. Attempt to find the user with matching email and password
        let result = await pool.request()
            .input('email', sql.VarChar, email)
            .input('password', sql.VarChar, password)
            .query('SELECT * FROM users WHERE email = @email AND password = @password');

        const isSuccess = result.recordset.length > 0;
        
        // 2. Get the name if successful, otherwise set to 'Unknown'
        const fullName = isSuccess ? result.recordset[0].name : 'Unknown Attempt';

        // 3. Record the login attempt with the Name
        await pool.request()
            .input('email', sql.VarChar, email)
            .input('name', sql.VarChar, fullName)
            .input('status', sql.VarChar, isSuccess ? 'SUCCESS' : 'FAILED')
            .query('INSERT INTO login_attempts (email, name, status) VALUES (@email, @name, @status)');

        if (isSuccess) {
            res.json({ success: true, name: result.recordset[0].name });
        } else {
            res.json({ success: false });
        }

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error during login");
    }
});

/*  SIGNUP */
app.post('/signup', async (req, res) => {
    const { name, email, password } = req.body;

    try {
        let pool = await sql.connect(config);

        await pool.request()
            .input('name', sql.VarChar, name)
            .input('email', sql.VarChar, email)
            .input('password', sql.VarChar, password)
            .query('INSERT INTO users (name, email, password) VALUES (@name, @email, @password)');

        res.json({ success: true });

    } catch (err) {
        console.log(err);
        res.status(500).send("Error");
    }
});

/* RESERVATIONS */
app.get('/reservations', async (req, res) => {
    try {
        let pool = await sql.connect(config);
        // We use "AS" to rename columns on the fly to match your admin.html JS
        let result = await pool.request().query(`
            SELECT 
                id AS reservationNumber, 
                name AS customerName, 
                arrivalDate, 
                arrivalTime, 
                tableNo AS bookedTable,
                'priority' AS reservationType 
            FROM reservations
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send("Database fetch error");
    }
});

/* SAVE NEW RESERVATION */
app.post('/reserve', async (req, res) => {
    // This logs the data to your terminal so you can see if it arrived!
    console.log("Saving new reservation for:", req.body.name);

    const { name, date, time, table } = req.body;

    try {
        let pool = await sql.connect(config);

        await pool.request()
            .input('name', sql.VarChar, name)
            .input('date', sql.VarChar, date)
            .input('time', sql.VarChar, time)
            .input('table', sql.VarChar, table)
            .query(`
                INSERT INTO reservations (name, arrivalDate, arrivalTime, tableNo)
                VALUES (@name, @date, @time, @table)
            `);

        res.json({ success: true });
    } catch (err) {
        console.error("SQL Save Error:", err);
        res.status(500).send("Error saving to database");
    }
});

app.listen(3000, () => console.log("Server running on port 3000"));