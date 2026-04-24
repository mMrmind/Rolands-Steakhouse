require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Serve all HTML, CSS, JS, images from the project root
app.use(express.static(__dirname));

// Initialize Supabase (Pulls from your .env file or Vercel Environment Variables)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;
if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
} else {
    console.warn('⚠️  Supabase credentials missing — DB features disabled, but PayMongo will still work.');
}


/* LOGIN */
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Attempt to find the user
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .eq('password', password);

        if (error) throw error;

        const isSuccess = data && data.length > 0;
        const fullName = isSuccess ? data[0].name : 'Unknown Attempt';

        // 2. Record the login attempt
        await supabase
            .from('login_attempts')
            .insert([{ email: email, name: fullName, status: isSuccess ? 'SUCCESS' : 'FAILED' }]);

        if (isSuccess) {
            res.json({ success: true, name: fullName });
        } else {
            res.json({ success: false });
        }

    } catch (err) {
        console.error(err);
        res.status(500).send("Server error during login");
    }
});

/* SIGNUP */
app.post('/signup', async (req, res) => {
    const { name, email, password } = req.body;

    try {
        const { error } = await supabase
            .from('users')
            .insert([{ name, email, password }]);

        if (error) throw error;
        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).send("Error");
    }
});

/* GET STAFF ACCOUNTS */
app.get('/api/staff', async (req, res) => {
    try {
        const { data, error } = await supabase.from('staff_accounts').select('*');
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).send("Database error");
    }
});

/* CREATE STAFF ACCOUNT */
app.post('/api/staff', async (req, res) => {
    const { username, passwordHash } = req.body;
    try {
        // PGSQL automatically makes column names lowercase, so we use passwordhash
        const { error } = await supabase
            .from('staff_accounts')
            .insert([{ username: username, passwordhash: passwordHash }]);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).send("Database error");
    }
});

/* DELETE STAFF ACCOUNT */
app.delete('/api/staff/:username', async (req, res) => {
    try {
        const { error } = await supabase
            .from('staff_accounts')
            .delete()
            .eq('username', req.params.username);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).send("Database error");
    }
});

/* RESERVATIONS */
app.get('/reservations', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('reservations')
            .select('id, name, arrivalDate, arrivalTime, tableNo');

        if (error) throw error;

        // Map columns on the fly to match your admin.html JS
        const mappedData = data.map(r => ({
            reservationNumber: r.id,
            customerName: r.name,
            arrivalDate: r.arrivalDate,
            arrivalTime: r.arrivalTime,
            bookedTable: r.tableNo,
            reservationType: 'priority'
        }));

        res.json(mappedData);
    } catch (err) {
        console.error(err);
        res.status(500).send("Database fetch error");
    }
});

/* SAVE NEW RESERVATION */
app.post('/reserve', async (req, res) => {
    console.log("Saving new reservation for:", req.body.name);
    const { name, date, time, table } = req.body;

    try {
        const { error } = await supabase
            .from('reservations')
            .insert([{ 
                name: name, 
                arrivalDate: date, 
                arrivalTime: time, 
                tableNo: table 
            }]);

        if (error) throw error;
        res.json({ success: true });

    } catch (err) {
        console.error("Supabase Save Error:", err);
        res.status(500).send("Error saving to database");
    }
});

/* CREATE PAYMONGO PAYMENT LINK (Links API — works on localhost & production) */
app.post('/api/paymongo/checkout', async (req, res) => {
    const { amount, description, customerName } = req.body;

    // Pick key based on PAYMONGO_MODE (.env: "test" or "live")
    const mode     = (process.env.PAYMONGO_MODE || 'test').toLowerCase();
    const finalKey = mode === 'live'
        ? (process.env.PAYMONGO_SECRET_KEY_LIVE || process.env.PAYMONGO_SECRET_KEY)
        : (process.env.PAYMONGO_SECRET_KEY_TEST || process.env.PAYMONGO_SECRET_KEY);

    if (!finalKey) {
        console.error('❌ PayMongo key missing in .env');
        return res.status(500).json({ error: 'PayMongo secret key not configured. Add it to your .env file.' });
    }

    const amountInCentavos = Math.round(Number(amount) * 100);
    if (amountInCentavos < 10000) { // PayMongo minimum is ₱100
        return res.status(400).json({ error: `Amount too low (₱${amount}). Minimum is ₱100.` });
    }

    console.log(`💳 PayMongo [${mode.toUpperCase()}] — ₱${amount} for ${customerName || 'Guest'}`);

    try {
        const pmRes = await fetch('https://api.paymongo.com/v1/links', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(finalKey + ':').toString('base64'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                data: {
                    attributes: {
                        amount:      amountInCentavos,
                        description: description || `Roland's Reservation — ${customerName || 'Guest'}`,
                        remarks:     `Customer: ${customerName || 'Guest'}`
                    }
                }
            })
        });

        const data = await pmRes.json();

        if (!pmRes.ok) {
            const errMsg = data?.errors?.[0]?.detail || JSON.stringify(data);
            console.error('❌ PayMongo rejected:', errMsg);
            return res.status(pmRes.status).json({ error: errMsg });
        }

        const checkoutUrl = data?.data?.attributes?.checkout_url;
        const linkId      = data?.data?.id;

        if (!checkoutUrl) {
            return res.status(500).json({ error: 'PayMongo returned no checkout URL.' });
        }

        console.log(`✅ PayMongo link created: ${checkoutUrl}`);
        res.json({ checkout_url: checkoutUrl, session_id: linkId });

    } catch (err) {
        console.error('❌ PayMongo network error:', err.message);
        res.status(500).json({ error: 'Could not reach PayMongo. Check your internet connection.' });
    }
});

// Run locally if testing on your laptop
if (process.env.NODE_ENV !== 'production') {
    app.listen(3000, () => console.log("Server running locally on port 3000"));
}

// Export for Vercel deployment
module.exports = app;
