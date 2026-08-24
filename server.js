const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Render ya kisi bhi proxy ke liye https protocol sahi se detect karne ke liye
app.set('trust proxy', 1);

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Database Connection & Admin Wallet Initialization
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/earning-app')
.then(async () => {
    console.log('MongoDB Connected Successfully!');
    let adminUser = await User.findOne({ phone: 'admin_master' });
    if (!adminUser) {
        await User.create({ name: 'Admin Master', phone: 'admin_master', wallet: 10000 });
        console.log('Admin Wallet Initialized with ₹10,000');
    }
    await Submission.deleteMany({});
})
.catch((err) => console.log('Database connection error: ', err));

// Task Schema & Model
const taskSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    logoUrl: { type: String, required: true },
    referLink: { type: String, required: true },
    rewardAmount: { type: Number, required: true }
});
const Task = mongoose.model('Task', taskSchema);

// User Schema & Model (Updated with Referral Tracking)
const userSchema = new mongoose.Schema({
    name: { type: String },
    phone: { type: String, required: true, unique: true },
    password: { type: String },
    wallet: { type: Number, default: 0 },
    referredBy: { type: String, default: '' },
    referralBonusGiven: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

// Task Submission Schema & Model
const submissionSchema = new mongoose.Schema({
    userPhone: { type: String, required: true },
    taskTitle: { type: String, required: true },
    rewardAmount: { type: Number, required: true },
    status: { type: String, default: 'Pending' }
});
const Submission = mongoose.model('Submission', submissionSchema);

// Withdrawal Schema & Model
const withdrawalSchema = new mongoose.Schema({
    userPhone: { type: String, required: true },
    amount: { type: Number, required: true },
    accountDetails: { type: String, required: true },
    status: { type: String, default: 'Pending' }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// --- 1. SIGNUP ROUTE (With Referral Code Handling) ---
app.post('/api/signup', async (req, res) => {
    try {
        const { name, phone, password, referralCode } = req.body;
        let trimmedPhone = phone.trim();
        
        let existingUser = await User.findOne({ phone: trimmedPhone });
        if (existingUser) {
            return res.json({ success: false, message: "Phone number already registered!" });
        }

        let referrerPhone = '';
        if (referralCode && referralCode.trim() !== trimmedPhone) {
            let referrer = await User.findOne({ phone: referralCode.trim() });
            if (referrer) {
                referrerPhone = referrer.phone;
            }
        }

        const newUser = new User({ 
            name, 
            phone: trimmedPhone, 
            password, 
            wallet: 0, 
            referredBy: referrerPhone,
            referralBonusGiven: false 
        });
        await newUser.save();
        res.json({ success: true, role: 'customer', user: newUser, message: "Signup successful!" });
    } catch (err) {
        console.error("Signup Error:", err);
        res.json({ success: false, message: "Server error during signup" });
    }
});

// --- 2. LOGIN ROUTE ---
app.post('/api/login', async (req, res) => {
    try {
        const { username, password, phone } = req.body;
        if (username === process.env.ADMIN_ID && password === process.env.ADMIN_PASS) {
            return res.json({ success: true, role: 'admin', message: "Admin login successful!" });
        }
        const queryPhone = (phone || username).trim();
        let user = await User.findOne({ phone: queryPhone });
        if (!user) {
            return res.json({ success: false, message: "User not found! Please Sign Up first." });
        }
        res.json({ success: true, role: 'customer', user, message: "Login successful!" });
    } catch (err) {
        console.error("Login Error:", err);
        res.json({ success: false, message: "Invalid Credentials or Server Error" });
    }
});

// --- 3. ADMIN WALLET ROUTE ---
app.get('/api/admin/wallet', async (req, res) => {
    try {
        let adminUser = await User.findOne({ phone: 'admin_master' });
        res.json({ success: true, wallet: adminUser ? adminUser.wallet : 0 });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. USER WALLET ROUTE ---
app.get('/api/user/wallet/:phone', async (req, res) => {
    try {
        const user = await User.findOne({ phone: req.params.phone.trim() });
        if (!user) return res.json({ success: false, message: "User not found", wallet: 0 });
        res.json({ success: true, wallet: user.wallet });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 5. TASKS ROUTES ---
app.get('/api/tasks', async (req, res) => {
    try {
        const tasks = await Task.find();
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

app.post('/api/admin/tasks', async (req, res) => {
    try {
        const newTask = new Task(req.body);
        await newTask.save();
        res.json({ success: true, message: "Task added successfully!" });
    } catch (err) {
        res.status(500).json({ error: "Failed to add task" });
    }
});

app.post('/api/admin/tasks/update/:id', async (req, res) => {
    try {
        await Task.findByIdAndUpdate(req.params.id, req.body);
        res.json({ success: true, message: "Task updated successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to update task" });
    }
});

app.post('/api/admin/tasks/delete/:id', async (req, res) => {
    try {
        await Task.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Task deleted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to delete task" });
    }
});

// --- 6. TASK SUBMISSIONS & REFERRAL BONUS (₹50 on First Task) ---
app.post('/api/submit-task', async (req, res) => {
    try {
        const { userPhone, taskTitle, rewardAmount } = req.body;
        let phone = userPhone.trim();

        const newSub = new Submission({ userPhone: phone, taskTitle, rewardAmount, status: 'Pending' });
        await newSub.save();

        let currentUser = await User.findOne({ phone });
        if (currentUser && currentUser.referredBy && !currentUser.referralBonusGiven) {
            let referrer = await User.findOne({ phone: currentUser.referredBy });
            if (referrer) {
                referrer.wallet += 50;
                await referrer.save();

                currentUser.referralBonusGiven = true;
                await currentUser.save();
            }
        }

        res.json({ success: true, message: "Task submitted for verification!" });
    } catch (err) {
        console.error("Submit task error:", err);
        res.json({ success: false, message: "Error submitting task" });
    }
});

app.get('/api/admin/submissions', async (req, res) => {
    try {
        const subs = await Submission.find();
        res.json(subs);
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

app.post('/api/admin/approve/:id', async (req, res) => {
    try {
        const sub = await Submission.findById(req.params.id);
        if (!sub || sub.status === 'Approved') {
            return res.json({ success: false, message: "Already approved or not found" });
        }

        let adminUser = await User.findOne({ phone: 'admin_master' });
        if (!adminUser || adminUser.wallet < sub.rewardAmount) {
            return res.json({ success: false, message: "Admin wallet balance is insufficient!" });
        }

        adminUser.wallet -= sub.rewardAmount;
        await adminUser.save();

        let customer = await User.findOne({ phone: sub.userPhone.trim() });
        if (customer) {
            customer.wallet += sub.rewardAmount;
            await customer.save();
        }

        sub.status = 'Approved';
        await sub.save();

        res.json({ success: true, message: `Successfully paid ₹${sub.rewardAmount} to customer!` });
    } catch (err) {
        console.error("Approval Error:", err);
        res.json({ success: false, message: "Approval failed" });
    }
});

// --- 7. WITHDRAWAL ROUTES (With 5% Admin Commission) ---
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userPhone, amount, accountDetails } = req.body;
        let user = await User.findOne({ phone: userPhone.trim() });
        
        if (!user) {
            return res.json({ success: false, message: "User not found!" });
        }

        const withdrawAmount = Number(amount);
        if (withdrawAmount <= 0) {
            return res.json({ success: false, message: "Invalid amount!" });
        }
        
        if (user.wallet < withdrawAmount) {
            return res.json({ success: false, message: "Insufficient funds in your wallet!" });
        }
        
        user.wallet -= withdrawAmount;
        await user.save();

        const commission = withdrawAmount * 0.05;
        let adminUser = await User.findOne({ phone: 'admin_master' });
        if (adminUser) {
            adminUser.wallet += commission;
            await adminUser.save();
        }

        const newWithdraw = new Withdrawal({ 
            userPhone: userPhone.trim(), 
            amount: withdrawAmount, 
            accountDetails, 
            status: 'Pending' 
        });
        await newWithdraw.save();
        
        res.json({ success: true, message: `Withdrawal request submitted successfully! (Admin earned ₹${commission} commission)` });
    } catch (err) {
        console.error("Withdrawal Error:", err);
        res.json({ success: false, message: "Error processing withdrawal" });
    }
});

app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const list = await Withdrawal.find();
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

app.get('/api/user/withdrawals/:phone', async (req, res) => {
    try {
        const list = await Withdrawal.find({ userPhone: req.params.phone.trim() });
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

app.post('/api/admin/approve-withdraw/:id', async (req, res) => {
    try {
        const wd = await Withdrawal.findById(req.params.id);
        if (!wd || wd.status === 'Approved') {
            return res.json({ success: false, message: "Already approved or not found" });
        }
        wd.status = 'Approved';
        await wd.save();
        res.json({ success: false, message: "Withdrawal request marked as Paid/Approved!" });
    } catch (err) {
        res.json({ success: false, message: "Approval failed" });
    }
});

// --- 8. REFERRAL STATS API ---
app.get('/api/user/referral-stats/:phone', async (req, res) => {
    try {
        const phone = req.params.phone.trim();
        const invitedCount = await User.countDocuments({ referredBy: phone });
        const rewardedCount = await User.countDocuments({ referredBy: phone, referralBonusGiven: true });
        
        res.json({ 
            success: true, 
            referralLink: `${req.protocol}://${req.get('host')}/login.html?ref=${phone}`,
            totalInvites: invitedCount,
            successfulInvites: rewardedCount,
            totalEarnings: rewardedCount * 50
        });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Native fetch ka use karke Telegram Bot integration
if (process.env.TELEGRAM_BOT_TOKEN) {
    const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    // Telegram par messages check karne aur reply dene ka loop (Polling)
    let offset = 0;
    setInterval(async () => {
        try {
            const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${offset}&timeout=30`);
            const data = await res.json();
            
            if (data.ok && data.result.length > 0) {
                for (let update of data.result) {
                    offset = update.update_id + 1;
                    
                    if (update.message && update.message.text === '/start') {
                        const chatId = update.message.chat.id;
                        const webUrl = 'https://earningapp-bhp9.onrender.com/login.html';
                        
                        const text = `🔥 *Welcome to EarningApp!* 🔥\n\nEarn real cash daily by completing simple tasks and offers. Refer your friends and get *₹50 bonus* instantly!\n\n👉 Click the button below to open the app and start earning:`;
                        
                        const payload = {
                            chat_id: chatId,
                            text: text,
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '🚀 Open Earning App', url: webUrl }]
                                ]
                            }
                        };

                        await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                    }
                }
            }
        } catch (err) {
            // Network glitch ignore karein
        }
    }, 2000);

    console.log('Telegram Bot Polling Started Successfully!');
}