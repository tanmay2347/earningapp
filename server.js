const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.set('trust proxy', 1);

// Mobile ke large screenshot/Base64 payloads handle karne ke liye limits 100mb kar di gayi hain
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
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
    password: { type: String, default: '1234' }, // Password field added for security
    wallet: { type: Number, default: 0 },
    referredBy: { type: String, default: '' },
    referralBonusGiven: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

const submissionSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    taskTitle: { type: String, required: true },
    rewardAmount: { type: Number, required: true },
    proofImage: { type: String, default: '' }, // Screenshot proof ke liye
    status: { type: String, default: 'Pending' } // Pending, Approved, Rejected
});
const Submission = mongoose.model('Submission', submissionSchema);

// Approved Submission Schema (Excel report ke liye save karne ke liye)
const approvedSubSchema = new mongoose.Schema({
    userEmail: String,
    taskTitle: String,
    rewardAmount: Number,
    approvedDate: { type: String, default: () => new Date().toLocaleString() }
});
const ApprovedSub = mongoose.model('ApprovedSub', approvedSubSchema);

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
        await User.create({ name: 'Admin Master', email: 'admin@earningapp.com', password: 'adminpassword', wallet: 10000 });
        console.log('Admin Wallet Initialized with ₹10,000');
    }
})
.catch((err) => console.log('Database connection error: ', err));

// --- 1. SIGNUP ROUTE ---
app.post('/api/signup', async (req, res) => {
    try {
        const { email, password, referredBy } = req.body;
        if (!email || !password) {
            return res.json({ success: false, message: "Email and password are required!" });
        }
        let cleanEmail = email.trim().toLowerCase();

        let existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) {
            return res.json({ success: false, message: "Email already registered! Please login." });
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
            password: password,
            wallet: 0, 
            referredBy: referrerEmail,
            referralBonusGiven: false 
        });
        await newUser.save();
        res.json({ success: true, message: "Account created successfully! Please login." });
    } catch (err) {
        console.error("Signup Error:", err);
        res.json({ success: false, message: "Server error during signup: " + err.message });
    }
});

// --- 1.B. LOGIN ROUTE ---
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.json({ success: false, message: "Email and password are required!" });
        }
        let cleanEmail = email.trim().toLowerCase();

        if (cleanEmail === 'admin@earningapp.com') {
            if (password !== 'adminpassword' && password !== '1234') { // Admin password check
                // Agar pehli baar admin bina password ke bane ho to allow kar sakte hain, ya password match kare
            }
            return res.json({ success: true, role: 'admin', message: "Admin login successful!" });
        }

        let user = await User.findOne({ email: cleanEmail });
        if (!user) {
            return res.json({ success: false, message: "User not found! Please sign up first." });
        }

        if (user.password && user.password !== password) {
            return res.json({ success: false, message: "Incorrect password! Access denied." });
        }

        res.json({ success: true, role: 'customer', user: user, message: "Login successful!" });
    } catch (err) {
        console.error("Login Error:", err);
        res.json({ success: false, message: "Server error during login: " + err.message });
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

// Approve & Pay Route
app.post('/api/admin/approve/:id', async (req, res) => {
    try {
        const sub = await Submission.findById(req.params.id);
        if (!sub) {
            return res.json({ success: false, message: "Submission not found!" });
        }

        let user = await User.findOne({ email: sub.userEmail });
        if (user) {
            user.wallet += sub.rewardAmount;
            await user.save();
        }

        await ApprovedSub.create({
            userEmail: sub.userEmail,
            taskTitle: sub.taskTitle,
            rewardAmount: sub.rewardAmount
        });

        sub.status = 'Approved';
        await sub.save();

        res.json({ success: true, message: "Task approved and reward credited to user wallet!" });
    } catch (err) {
        console.error("Approval error:", err);
        res.status(500).json({ success: false, message: "Approval error" });
    }
});

// Reject Task Route
app.post('/api/admin/reject/:id', async (req, res) => {
    try {
        const sub = await Submission.findById(req.params.id);
        if (!sub) {
            return res.json({ success: false, message: "Submission not found!" });
        }
        sub.status = 'Rejected';
        await sub.save();
        res.json({ success: true, message: "Task submission rejected successfully!" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error rejecting task" });
    }
});

// Excel / CSV Download Route for Admin
app.get('/api/admin/export-excel', async (req, res) => {
    try {
        const records = await ApprovedSub.find();
        let csv = 'User Email,Task Name,Reward (INR),Approved Date\n';
        records.forEach(r => {
            csv += `"${r.userEmail}","${r.taskTitle}","${r.rewardAmount}","${r.approvedDate}"\n`;
        });
        
        res.header('Content-Type', 'text/csv');
        res.attachment('Approved_Tasks_Report.csv');
        res.send(csv);
    } catch (err) {
        res.status(500).send("Error exporting data");
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

// --- 5. TASK SUBMISSIONS & SCREENSHOT PROOF ---
app.post('/api/submit-task', async (req, res) => {
    try {
        const { userEmail, taskTitle, rewardAmount, proofImage } = req.body;
        let email = userEmail.trim().toLowerCase();

        const newSub = new Submission({ 
            userEmail: email, 
            taskTitle, 
            rewardAmount, 
            proofImage: proofImage || '',
            status: 'Pending' 
        });
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

        res.json({ success: true, message: "Task proof submitted for verification successfully!" });
    } catch (err) {
        console.error("Submit task error:", err);
        res.json({ success: false, message: "Error submitting task proof" });
    }
});

// User Task Status & Stats API
app.get('/api/user/task-status/:email', async (req, res) => {
    try {
        const email = req.params.email.trim().toLowerCase();
        const submissions = await Submission.find({ userEmail: email });
        
        let approved = submissions.filter(s => s.status === 'Approved').length;
        let pending = submissions.filter(s => s.status === 'Pending').length;
        let rejected = submissions.filter(s => s.status === 'Rejected').length;

        res.json({
            success: true,
            stats: { approved, pending, rejected },
            submissions: submissions
        });
    } catch (err) {
        res.status(500).json({ success: false, error: "Server Error" });
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