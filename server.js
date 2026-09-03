const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.set('trust proxy', 1);

app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// --- SCHEMAS & MODELS ---
const taskSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, default: 'Complete task & earn reward' },
    logoUrl: { type: String, required: true },
    referLink: { type: String, required: true },
    rewardAmount: { type: Number, required: true }
});
const Task = mongoose.model('Task', taskSchema);

const userSchema = new mongoose.Schema({
    name: { type: String, default: 'User' },
    email: { type: String, required: true, unique: true },
    wallet: { type: Number, default: 0 },
    referredBy: { type: String, default: '' },
    referralBonusGiven: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const submissionSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    taskTitle: { type: String, required: true },
    rewardAmount: { type: Number, required: true },
    status: { type: String, default: 'Pending' }
});
const Submission = mongoose.model('Submission', submissionSchema);

const withdrawalSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    amount: { type: Number, required: true },
    accountDetails: { type: String, required: true },
    status: { type: String, default: 'Pending' }
});
const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// --- DATABASE CONNECTION & ADMIN INITIALIZATION ---
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/earning-app')
.then(async () => {
    console.log('MongoDB Connected Successfully!');
    let adminUser = await User.findOne({ email: 'admin@earningapp.com' });
    if (!adminUser) {
        await User.create({ name: 'Admin Master', email: 'admin@earningapp.com', wallet: 10000 });
        console.log('Admin Wallet Initialized with ₹10,000');
    }
})
.catch((err) => console.log('Database connection error: ', err));

// --- 1. SIGNUP / LOGIN ROUTE ---
app.post('/api/signup', async (req, res) => {
    try {
        const { email, referredBy } = req.body;
        if (!email) {
            return res.json({ success: false, message: "Email is required!" });
        }
        let cleanEmail = email.trim().toLowerCase();

        if (cleanEmail === 'admin@earningapp.com') {
            return res.json({ success: true, role: 'admin', message: "Admin login successful!" });
        }

        let existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) {
            return res.json({ success: true, role: 'customer', user: existingUser, message: "Login successful!" });
        }

        let referrerEmail = '';
        if (referredBy && referredBy.trim().toLowerCase() !== cleanEmail) {
            let referrer = await User.findOne({ email: referredBy.trim().toLowerCase() });
            if (referrer) {
                referrerEmail = referrer.email;
            }
        }

        const newUser = new User({ 
            email: cleanEmail, 
            wallet: 0, 
            referredBy: referrerEmail,
            referralBonusGiven: false 
        });
        await newUser.save();
        res.json({ success: true, role: 'customer', user: newUser, message: "Account created successfully!" });
    } catch (err) {
        console.error("Auth Error:", err);
        res.json({ success: false, message: "Server error during authentication: " + err.message });
    }
});

// --- 2. ADMIN WALLET & DASHBOARD ROUTES ---
app.get('/api/admin/wallet', async (req, res) => {
    try {
        let adminUser = await User.findOne({ email: 'admin@earningapp.com' });
        res.json({ success: true, wallet: adminUser ? adminUser.wallet : 0 });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
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

app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const wds = await Withdrawal.find();
        res.json(wds);
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

app.post('/api/admin/approve/:id', async (req, res) => {
    try {
        const sub = await Submission.findById(req.params.id);
        if (!sub || sub.status === 'Approved') {
            return res.json({ success: false, message: "Already approved or not found!" });
        }
        sub.status = 'Approved';
        await sub.save();

        let user = await User.findOne({ email: sub.userEmail });
        if (user) {
            user.wallet += sub.rewardAmount;
            await user.save();
        }
        res.json({ success: true, message: "Task approved and reward credited to user wallet!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Approval error" });
    }
});

app.post('/api/admin/approve-withdraw/:id', async (req, res) => {
    try {
        const wd = await Withdrawal.findById(req.params.id);
        if (!wd || wd.status === 'Approved') {
            return res.json({ success: false, message: "Already approved or not found!" });
        }
        wd.status = 'Approved';
        await wd.save();
        res.json({ success: true, message: "Withdrawal request marked as paid!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error updating withdrawal" });
    }
});

// --- 3. USER WALLET ROUTE ---
app.get('/api/user/wallet/:email', async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email.trim().toLowerCase() });
        if (!user) return res.json({ success: false, message: "User not found", wallet: 0 });
        res.json({ success: true, wallet: user.wallet });
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 4. TASKS ROUTES ---
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
        const { title, description, logoUrl, referLink, rewardAmount } = req.body;
        const newTask = new Task({
            title,
            description: description || 'Complete task & earn reward',
            logoUrl: logoUrl || 'https://via.placeholder.com/50',
            referLink,
            rewardAmount
        });
        await newTask.save();
        res.json({ success: true, message: "Task added successfully!" });
    } catch (err) {
        console.error("Failed to add task:", err);
        res.status(500).json({ success: false, error: "Failed to add task" });
    }
});

app.post('/api/admin/tasks/update/:id', async (req, res) => {
    try {
        const { title, description, logoUrl, referLink, rewardAmount } = req.body;
        await Task.findByIdAndUpdate(req.params.id, {
            title, description, logoUrl, referLink, rewardAmount
        });
        res.json({ success: true, message: "Task updated successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to update task" });
    }
});

// Delete route supporting both DELETE and POST methods
app.delete('/api/admin/tasks/delete/:id', async (req, res) => {
    try {
        await Task.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Task deleted successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Failed to delete task" });
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

// --- 5. TASK SUBMISSIONS & REFERRAL BONUS ---
app.post('/api/submit-task', async (req, res) => {
    try {
        const { userEmail, taskTitle, rewardAmount } = req.body;
        let email = userEmail.trim().toLowerCase();

        const newSub = new Submission({ userEmail: email, taskTitle, rewardAmount, status: 'Pending' });
        await newSub.save();

        let currentUser = await User.findOne({ email });
        if (currentUser && currentUser.referredBy && !currentUser.referralBonusGiven) {
            let referrer = await User.findOne({ email: currentUser.referredBy });
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

// --- 6. WITHDRAWAL ROUTES ---
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userEmail, amount, accountDetails } = req.body;
        let user = await User.findOne({ email: userEmail.trim().toLowerCase() });
        
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
        let adminUser = await User.findOne({ email: 'admin@earningapp.com' });
        if (adminUser) {
            adminUser.wallet += commission;
            await adminUser.save();
        }

        const newWithdraw = new Withdrawal({ 
            userEmail: user.email, 
            amount: withdrawAmount, 
            accountDetails, 
            status: 'Pending' 
        });
        await newWithdraw.save();
        
        res.json({ success: true, message: `Withdrawal request submitted successfully!` });
    } catch (err) {
        console.error("Withdrawal Error:", err);
        res.json({ success: false, message: "Error processing withdrawal" });
    }
});

app.get('/api/user/withdrawals/:email', async (req, res) => {
    try {
        const list = await Withdrawal.find({ userEmail: req.params.email.trim().toLowerCase() });
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

// --- 7. REFERRAL STATS API ---
app.get('/api/user/referral-stats/:email', async (req, res) => {
    try {
        const email = req.params.email.trim().toLowerCase();
        const invitedCount = await User.countDocuments({ referredBy: email });
        const rewardedCount = await User.countDocuments({ referredBy: email, referralBonusGiven: true });
        
        res.json({ 
            success: true, 
            referralLink: `${req.protocol}://${req.get('host')}/login.html?ref=${email}`,
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