const API_BASE = 'http://172.31.110.79:3000/api';
let currentToken = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let currentEditingItem = null;
let otpTimerInterval = null;
let currentOtpEmail = '';
let currentOtpIsSignup = false;

// ============== DOM Elements ==============
const loginPage = document.getElementById('loginPage');
const dashboardPage = document.getElementById('dashboardPage');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const otpVerificationForm = document.getElementById('otpVerificationForm');
const otpSignupVerificationForm = document.getElementById('otpSignupVerificationForm');

// ============== Initial Load ==============
document.addEventListener('DOMContentLoaded', () => {
    if (currentToken) {
        showDashboard();
    }
    initializeOtpInputs();
});

// ============== OTP Input Handler ==============
function initializeOtpInputs() {
    // Login OTP inputs
    const loginOtpInputs = document.querySelectorAll('#otpInputs .otp-digit');
    loginOtpInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => handleOtpInput(e, index, loginOtpInputs));
        input.addEventListener('keydown', (e) => handleOtpKeydown(e, index, loginOtpInputs));
    });

    // Signup OTP inputs
    const signupOtpInputs = document.querySelectorAll('#otpSignupInputs .otp-digit-signup');
    signupOtpInputs.forEach((input, index) => {
        input.addEventListener('input', (e) => handleOtpInput(e, index, signupOtpInputs));
        input.addEventListener('keydown', (e) => handleOtpKeydown(e, index, signupOtpInputs));
    });
}

function handleOtpInput(e, index, inputs) {
    if (e.target.value) {
        e.target.value = e.target.value.slice(-1);
        if (index < inputs.length - 1) {
            inputs[index + 1].focus();
        }
    }
}

function handleOtpKeydown(e, index, inputs) {
    if (e.key === 'Backspace' && !e.target.value && index > 0) {
        inputs[index - 1].focus();
    }
}

function getOtpValue(selector) {
    const inputs = document.querySelectorAll(selector);
    return Array.from(inputs).map(input => input.value).join('');
}

function clearOtpInputs(selector) {
    const inputs = document.querySelectorAll(selector);
    inputs.forEach(input => input.value = '');
    inputs[0].focus();
}

// ============== OTP Timer ==============
function startOtpTimer(timerElementId, duration = 300) {
    let timeLeft = duration;
    const timerElement = document.getElementById(timerElementId);
    
    if (otpTimerInterval) clearInterval(otpTimerInterval);
    
    otpTimerInterval = setInterval(() => {
        const minutes = Math.floor(timeLeft / 60);
        const seconds = timeLeft % 60;
        timerElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        if (timeLeft === 0) {
            clearInterval(otpTimerInterval);
            timerElement.textContent = 'Expired';
        }
        timeLeft--;
    }, 1000);
}

// ============== Auth Functions ==============

// Show Message
function showAuthMessage(message, isError = false) {
    const messageDiv = document.getElementById('authMessage');
    messageDiv.textContent = message;
    messageDiv.className = `mt-6 p-3 rounded-lg ${isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`;
    messageDiv.classList.remove('hidden');
    setTimeout(() => messageDiv.classList.add('hidden'), 6000);
}

// ============== Google Sign-In (Request to Backend) ==============
document.getElementById('googleSignInBtn')?.addEventListener('click', async () => {
    try {
        showAuthMessage('Opening Google Sign-In...', false);
        
        // Request backend to generate Google auth URL
        const res = await fetch(`${API_BASE}/auth/google-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();
        if (!res.ok) {
            showAuthMessage(data.message || 'Google login not available', true);
            return;
        }

        // Open Google auth URL in popup
        const width = 500;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;
        
        const popup = window.open(
            data.authUrl,
            'Google Sign-In',
            `width=${width},height=${height},left=${left},top=${top}`
        );

        // Poll for auth completion
        let pollCount = 0;
        const pollInterval = setInterval(async () => {
            pollCount++;
            
            // Check if popup closed
            if (popup.closed) {
                clearInterval(pollInterval);
                
                // Check if auth was successful
                try {
                    const statusRes = await fetch(`${API_BASE}/auth/google-status`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
                    });
                    
                    if (statusRes.ok) {
                        const statusData = await statusRes.json();
                        if (statusData.authenticated) {
                            currentToken = statusData.token;
                            currentUser = statusData.user;
                            localStorage.setItem('token', statusData.token);
                            localStorage.setItem('user', JSON.stringify(statusData.user));
                            showDashboard();
                            showAuthMessage('Google login successful!', false);
                        }
                    }
                } catch (error) {
                    console.error('Error checking auth status:', error);
                }
            }
            
            // Timeout after 5 minutes
            if (pollCount > 300) {
                clearInterval(pollInterval);
                if (!popup.closed) popup.close();
                showAuthMessage('Google login timeout', true);
            }
        }, 1000);

    } catch (error) {
        console.error('Google sign-in error:', error);
        showAuthMessage('Google login failed', true);
    }
});

// ============== Email Login - Send OTP ==============
document.getElementById('loginSubmitBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    if (!email) {
        showAuthMessage('Please enter your email', true);
        return;
    }

    try {
        // First, check if email exists and what login type it uses
        const checkRes = await fetch(`${API_BASE}/auth/check-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        const checkData = await checkRes.json();

        if (checkRes.ok && checkData.exists) {
            // Email exists - check login type
            if (checkData.login_type === 'google') {
                showAuthMessage(
                    `⚠️ This email is registered with Google Sign-In. Please use "Sign in with Google" button instead.`,
                    true
                );
                document.getElementById('loginEmail').value = '';
                return;
            }
            // Email exists with email login - proceed with OTP
            showAuthMessage(`Welcome back! OTP will be sent to ${email}`, false);
        } else {
            // Email doesn't exist - will be auto-registered after OTP verification
            showAuthMessage(
                `📝 New email detected. You will be automatically registered after OTP verification.`,
                false
            );
        }

        // Send OTP
        const res = await fetch(`${API_BASE}/auth/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, isSignup: false })
        });

        const data = await res.json();
        if (!res.ok) {
            showAuthMessage(data.message, true);
            return;
        }

        currentOtpEmail = email;
        currentOtpIsSignup = false;
        
        // Show OTP verification form
        loginForm.classList.add('hidden');
        otpVerificationForm.classList.remove('hidden');
        document.getElementById('otpEmailDisplay').textContent = email;
        localStorage.setItem('rememberMe', rememberMe);
        
        clearOtpInputs('#otpInputs .otp-digit');
        startOtpTimer('otpTimer');
        
        showAuthMessage('✓ OTP sent to your email', false);
    } catch (error) {
        console.error('Error checking email:', error);
        showAuthMessage('Error processing login request', true);
    }
});

// ============== Email Login - Verify OTP (Updated) ==============
document.getElementById('verifyOtpBtn')?.addEventListener('click', async () => {
    const otp = getOtpValue('#otpInputs .otp-digit');
    const rememberMe = localStorage.getItem('rememberMe') === 'true';

    if (otp.length !== 6) {
        showAuthMessage('Please enter a valid 6-digit code', true);
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: currentOtpEmail,
                otp,
                rememberMe,
                isSignup: false,
                isAutoRegister: true
            })
        });

        const data = await res.json();
        if (!res.ok) {
            showAuthMessage(data.message, true);
            return;
        }

        currentToken = data.token;
        currentUser = data.user;
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Show success message
        if (data.isNewUser) {
            showAuthMessage(`🎉 Welcome! Your account has been created and you're now logged in.`, false);
        } else {
            showAuthMessage(`✓ Login successful!`, false);
        }
        
        setTimeout(() => showDashboard(), 1500);
    } catch (error) {
        console.error('Verify OTP error:', error);
        showAuthMessage('Error verifying OTP', true);
    }
});

// ============== Email Signup - Send OTP ==============
document.getElementById('signupSubmitBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;

    if (!name || !email) {
        showAuthMessage('Please fill all fields', true);
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, isSignup: true })
        });

        const data = await res.json();
        if (!res.ok) {
            showAuthMessage(data.message, true);
            return;
        }

        currentOtpEmail = email;
        currentOtpIsSignup = true;
        
        // Show OTP verification form
        signupForm.classList.add('hidden');
        otpSignupVerificationForm.classList.remove('hidden');
        document.getElementById('otpSignupEmailDisplay').textContent = email;
        localStorage.setItem('signupName', name);
        localStorage.setItem('signupRememberMe', document.getElementById('signupRememberMe').checked);
        
        clearOtpInputs('#otpSignupInputs .otp-digit-signup');
        startOtpTimer('otpSignupTimer');
        
        showAuthMessage('OTP sent to your email', false);
    } catch (error) {
        showAuthMessage('Error sending OTP', true);
    }
});

// ============== Email Signup - Verify OTP ==============
document.getElementById('verifyOtpSignupBtn')?.addEventListener('click', async () => {
    const otp = getOtpValue('#otpSignupInputs .otp-digit-signup');
    const name = localStorage.getItem('signupName');
    const rememberMe = localStorage.getItem('signupRememberMe') === 'true';

    if (otp.length !== 6) {
        showAuthMessage('Please enter a valid 6-digit code', true);
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/verify-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: currentOtpEmail,
                otp,
                name,
                rememberMe,
                isSignup: true
            })
        });

        const data = await res.json();
        if (!res.ok) {
            showAuthMessage(data.message, true);
            return;
        }

        currentToken = data.token;
        currentUser = data.user;
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        showDashboard();
    } catch (error) {
        showAuthMessage('Error verifying OTP', true);
    }
});

// ============== OTP Resend ==============
document.getElementById('resendOtpBtn')?.addEventListener('click', async () => {
    try {
        const res = await fetch(`${API_BASE}/auth/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentOtpEmail, isSignup: currentOtpIsSignup })
        });

        const data = await res.json();
        if (!res.ok) {
            showAuthMessage(data.message, true);
            return;
        }

        clearOtpInputs('#otpInputs .otp-digit');
        startOtpTimer('otpTimer');
        showAuthMessage('OTP resent to your email', false);
    } catch (error) {
        showAuthMessage('Error resending OTP', true);
    }
});

document.getElementById('resendOtpSignupBtn')?.addEventListener('click', async () => {
    try {
        const res = await fetch(`${API_BASE}/auth/send-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: currentOtpEmail, isSignup: true })
        });

        const data = await res.json();
        if (!res.ok) {
            showAuthMessage(data.message, true);
            return;
        }

        clearOtpInputs('#otpSignupInputs .otp-digit-signup');
        startOtpTimer('otpSignupTimer');
        showAuthMessage('OTP resent to your email', false);
    } catch (error) {
        showAuthMessage('Error resending OTP', true);
    }
});

// ============== Form Navigation ==============
document.getElementById('showSignupBtn')?.addEventListener('click', () => {
    loginForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
});

document.getElementById('showLoginBtn')?.addEventListener('click', () => {
    signupForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
});

document.getElementById('backToLoginBtn')?.addEventListener('click', () => {
    otpVerificationForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    clearOtpInputs('#otpInputs .otp-digit');
    if (otpTimerInterval) clearInterval(otpTimerInterval);
});

document.getElementById('backToSignupBtn')?.addEventListener('click', () => {
    otpSignupVerificationForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
    clearOtpInputs('#otpSignupInputs .otp-digit-signup');
    if (otpTimerInterval) clearInterval(otpTimerInterval);
});

// Signup
document.getElementById('signupSubmitBtn').addEventListener('click', async () => {
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const confirmPassword = document.getElementById('signupConfirmPassword').value;

    if (!name || !email || !password || !confirmPassword) {
        showAuthMessage('Please fill all fields', true);
        return;
    }

    if (password !== confirmPassword) {
        showAuthMessage('Passwords do not match', true);
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name })
        });

        const data = await res.json();
        if (!res.ok) {
            showAuthMessage(data.message, true);
            return;
        }

        showAuthMessage('Account created! Please login.');
        setTimeout(() => {
            signupForm.classList.add('hidden');
            loginForm.classList.remove('hidden');
            document.getElementById('signupName').value = '';
            document.getElementById('signupEmail').value = '';
            document.getElementById('signupPassword').value = '';
            document.getElementById('signupConfirmPassword').value = '';
        }, 2000);
    } catch (error) {
        showAuthMessage('Signup failed', true);
    }
});

// Forgot Password
document.getElementById('requestOtpBtn').addEventListener('click', async () => {
    
    let email = document.getElementById('resetEmail').value;
    if (!email) {
        showAuthMessage('Please enter your email', true);
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        console.log("Requesting OTP for email:", email);
        const data = await res.json();
        if (!res.ok) {
            showAuthMessage(data.message, true);
            return;
        }

        showAuthMessage('OTP sent to your email');
        otpSection.classList.remove('hidden');
    } catch (error) {
        showAuthMessage('Request failed', true);
    }
});

// Reset Password
document.getElementById('resetPasswordBtn').addEventListener('click', async () => {
    const email = document.getElementById('resetEmail').value;
    const otp = document.getElementById('otpInput').value;
    const newPassword = document.getElementById('newPassword').value;

    if (!email || !otp || !newPassword) {
        showAuthMessage('Please fill all fields', true);
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, otp, newPassword })
        });

        const data = await res.json();
        if (!res.ok) {
            showAuthMessage(data.message, true);
            return;
        }

        showAuthMessage('Password reset successfully!');
        setTimeout(() => {
            forgotPasswordForm.classList.add('hidden');
            loginForm.classList.remove('hidden');
            document.getElementById('resetEmail').value = '';
            document.getElementById('otpInput').value = '';
            document.getElementById('newPassword').value = '';
            otpSection.classList.add('hidden');
        }, 2000);
    } catch (error) {
        showAuthMessage('Password reset failed', true);
    }
});


document.getElementById('showLoginBtn').addEventListener('click', () => {
    signupForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
});



document.getElementById('backToLoginBtn').addEventListener('click', () => {
    forgotPasswordForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    document.getElementById('resetEmail').value = '';
    document.getElementById('otpInput').value = '';
    document.getElementById('newPassword').value = '';
    otpSection.classList.add('hidden');
});

// ============== Dashboard Functions ==============

function showDashboard() {
    loginPage.classList.add('hidden');
    dashboardPage.classList.remove('hidden');
    document.getElementById('userEmail').textContent = currentUser.email;
    document.getElementById('userEmail').classList.remove('hidden');
    document.getElementById('logoutBtn').classList.remove('hidden');
    loadBrowseItems();
    loadUserPoints();
}

function hideDashboard() {
    loginPage.classList.remove('hidden');
    dashboardPage.classList.add('hidden');
    document.getElementById('userEmail').classList.add('hidden');
    document.getElementById('logoutBtn').classList.add('hidden');
    currentToken = null;
    currentUser = {};
    localStorage.removeItem('token');
    localStorage.removeItem('user');
}

// Logout
document.getElementById('logoutBtn').addEventListener('click', hideDashboard);

// Tab Navigation
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.remove('active', 'border-blue-600', 'text-blue-600');
            b.classList.add('border-transparent', 'text-gray-600');
        });
        btn.classList.add('active', 'border-blue-600', 'text-blue-600');
        btn.classList.remove('border-transparent', 'text-gray-600');

        document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
        document.getElementById(`${tabName}-tab`).classList.remove('hidden');

        if (tabName === 'my-items') loadMyItems();
        if (tabName === 'resolved-items') loadResolvedItems();
    });
});

// Load Browse Items
async function loadBrowseItems() {
    try {
        const res = await fetch(`${API_BASE}/items`);
        const items = await res.json();
        displayItems(items, 'itemsList');
    } catch (error) {
        console.error('Error loading items:', error);
    }
}

// Load My Items
async function loadMyItems() {
    try {
        const res = await fetch(`${API_BASE}/items/user`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const items = await res.json();
        displayItems(items, 'myItemsList', true);
    } catch (error) {
        console.error('Error loading my items:', error);
    }
}

// Load Resolved Items
async function loadResolvedItems() {
    try {
        const res = await fetch(`${API_BASE}/items?status=resolved`);
        const items = await res.json();
        displayResolvedItems(items);
    } catch (error) {
        console.error('Error loading resolved items:', error);
    }
}

// Load User Points
async function loadUserPoints() {
    try {
        const res = await fetch(`${API_BASE}/users/points`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        const pointsDisplay = document.getElementById('userPoints');
        pointsDisplay.textContent = `${data.points} pts`;
        pointsDisplay.classList.remove('hidden');
    } catch (error) {
        console.error('Error loading points:', error);
    }
}

// Display Items
function displayItems(items, containerId, isUserItems = false) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-600 py-8">No items found</p>';
        return;
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'bg-white rounded-lg shadow-md hover:shadow-lg transition overflow-hidden cursor-pointer';
        
        // Determine card color based on status first, then item type
        let bgColor = '';
        let icon = '';
        let statusDisplay = '';
        
        if (item.status === 'resolved') {
            bgColor = 'from-green-400 to-green-600';
            icon = 'fa-check-circle';
            statusDisplay = 'RESOLVED';
        } else if (item.item_type === 'lost') {
            bgColor = 'from-red-400 to-red-600';
            icon = 'fa-question-circle';
            statusDisplay = item.status.toUpperCase();
        } else {
            bgColor = 'from-blue-400 to-blue-600';
            icon = 'fa-check-circle';
            statusDisplay = item.status.toUpperCase();
        }
        
        card.innerHTML = `
            <div class="bg-gradient-to-r ${bgColor} h-32 flex items-center justify-center">
                <i class="fas ${icon} text-white text-4xl"></i>
            </div>
            <div class="p-4">
                <div class="flex justify-between items-start mb-2">
                    <h3 class="font-bold text-lg text-gray-800">${item.title}</h3>
                    <span class="text-xs font-semibold ${item.status === 'resolved' ? 'bg-green-100 text-green-800' : item.item_type === 'lost' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'} px-2 py-1 rounded">
                        ${statusDisplay}
                    </span>
                </div>
                <p class="text-sm text-gray-600 mb-2 line-clamp-2">${item.description || 'No description'}</p>
                <p class="text-sm text-gray-500"><i class="fas fa-map-marker-alt mr-1"></i>${item.location || 'Location not specified'}</p>
                <p class="text-xs text-gray-400 mt-2">${new Date(item.created_at).toLocaleDateString()}</p>
            </div>
        `;
        card.addEventListener('click', () => showItemDetail(item, isUserItems));
        container.appendChild(card);
    });
}

// Display Resolved Items with Resolver Information
function displayResolvedItems(items) {
    const container = document.getElementById('resolvedItemsList');
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = '<p class="col-span-full text-center text-gray-600 py-8">No resolved items yet</p>';
        return;
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'bg-white rounded-lg shadow-md hover:shadow-lg transition overflow-hidden cursor-pointer';
        const resolvedDate = item.resolved_at ? new Date(item.resolved_at).toLocaleDateString() : 'Unknown';
        const resolverName = item.resolved_by_name || 'Unknown';
        const claimerName = item.claim_user_name || 'Unknown';
        
        card.innerHTML = `
            <div class="bg-gradient-to-r from-green-400 to-green-600 h-32 flex items-center justify-center">
                <i class="fas fa-check-circle text-white text-4xl"></i>
            </div>
            <div class="p-4">
                <div class="flex justify-between items-start mb-2">
                    <h3 class="font-bold text-lg text-gray-800">${item.title}</h3>
                    <span class="text-xs font-semibold bg-green-100 text-green-800 px-2 py-1 rounded">
                        RESOLVED
                    </span>
                </div>
                <p class="text-sm text-gray-600 mb-2 line-clamp-2">${item.description || 'No description'}</p>
                <p class="text-sm text-gray-500"><i class="fas fa-map-marker-alt mr-1"></i>${item.location || 'Location not specified'}</p>
                <div class="mt-3 pt-3 border-t">
                    <p class="text-xs text-blue-600 font-semibold"><i class="fas fa-user-check mr-1"></i>Resolved by: ${resolverName}</p>
                    <p class="text-xs text-purple-600 font-semibold"><i class="fas fa-user-tie mr-1"></i>Item found by: ${claimerName}</p>
                    <p class="text-xs text-gray-400 mt-1"><i class="fas fa-calendar mr-1"></i>Resolved on: ${resolvedDate}</p>
                </div>
            </div>
        `;
        card.addEventListener('click', () => showResolvedItemDetail(item));
        container.appendChild(card);
    });
}

// Show Resolved Item Detail with Full Information
function showResolvedItemDetail(item) {
    const modal = document.getElementById('itemModal');
    document.getElementById('modalTitle').textContent = item.title;
    
    const statusBadgeClass = {
        'active': 'bg-blue-100 text-blue-800',
        'resolved': 'bg-green-100 text-green-800',
        'claimed': 'bg-purple-100 text-purple-800',
        'found': 'bg-orange-100 text-orange-800'
    };

    const resolvedDate = item.resolved_at ? new Date(item.resolved_at).toLocaleDateString() : 'Unknown';
    
    document.getElementById('modalContent').innerHTML = `
        <div class="space-y-3">
            <div class="flex justify-between items-start">
                <div>
                    <p class="text-sm text-gray-600">Type</p>
                    <p class="font-semibold text-gray-800 capitalize">${item.item_type}</p>
                </div>
                <span class="text-xs font-semibold ${statusBadgeClass[item.status] || 'bg-gray-100 text-gray-800'} px-3 py-1 rounded">
                    ${item.status.toUpperCase()}
                </span>
            </div>
            ${item.category ? `<div><p class="text-sm text-gray-600">Category</p><p class="font-semibold text-gray-800">${item.category}</p></div>` : ''}
            <div><p class="text-sm text-gray-600">Description</p><p class="font-semibold text-gray-800">${item.description || 'N/A'}</p></div>
            ${item.location ? `<div><p class="text-sm text-gray-600">Item Location</p><p class="font-semibold text-gray-800">${item.location}</p></div>` : ''}
            ${item.item_date ? `<div><p class="text-sm text-gray-600">Date</p><p class="font-semibold text-gray-800">${new Date(item.item_date).toLocaleDateString()}</p></div>` : ''}
            <hr class="my-4">
            <div class="bg-green-50 p-4 rounded-lg border border-green-200">
                <h4 class="font-bold text-green-800 mb-3"><i class="fas fa-check-circle mr-2"></i>Resolution Details</h4>
                <div class="space-y-2">
                    <div><p class="text-sm text-gray-600">Resolved by</p><p class="font-semibold text-gray-800">${item.resolved_by_name || 'Unknown'} (${item.resolved_by_email || 'N/A'})</p></div>
                    <div><p class="text-sm text-gray-600">Item found by</p><p class="font-semibold text-gray-800">${item.claim_user_name || 'Unknown'} (${item.claim_user_email || 'N/A'})</p></div>
                    <div><p class="text-sm text-gray-600">Resolved on</p><p class="font-semibold text-gray-800">${resolvedDate}</p></div>
                </div>
            </div>
            ${item.claim_location ? `<div><p class="text-sm text-gray-600">Item Found At</p><p class="font-semibold text-gray-800">${item.claim_location}</p></div>` : ''}
            ${item.claim_description ? `<div><p class="text-sm text-gray-600">Finder's Description</p><p class="font-semibold text-gray-800">${item.claim_description}</p></div>` : ''}
            ${item.claim_contact_email ? `<div><p class="text-sm text-gray-600">Finder's Email</p><p class="font-semibold text-gray-800">${item.claim_contact_email}</p></div>` : ''}
            ${item.claim_contact_phone ? `<div><p class="text-sm text-gray-600">Finder's Phone</p><p class="font-semibold text-gray-800">${item.claim_contact_phone}</p></div>` : ''}
        </div>
    `;

    // Hide all buttons for resolved items view
    document.getElementById('editItemBtn').classList.add('hidden');
    document.getElementById('deleteItemBtn').classList.add('hidden');
    document.getElementById('markFoundBtn').classList.add('hidden');
    document.getElementById('markClaimedBtn').classList.add('hidden');
    document.getElementById('viewClaimsBtn').classList.add('hidden');
    document.getElementById('contactUserBtn').classList.add('hidden');
    document.getElementById('claimFoundBtn').classList.add('hidden');

    modal.classList.remove('hidden');
}

// Show Item Detail
async function showItemDetail(item, isUserItems) {
    const modal = document.getElementById('itemModal');
    document.getElementById('modalTitle').textContent = item.title;
    
    const statusBadgeClass = {
        'active': 'bg-blue-100 text-blue-800',
        'resolved': 'bg-green-100 text-green-800',
        'claimed': 'bg-purple-100 text-purple-800',
        'found': 'bg-orange-100 text-orange-800'
    };

    document.getElementById('modalContent').innerHTML = `
        <div class="space-y-3">
            <div class="flex justify-between items-start">
                <div>
                    <p class="text-sm text-gray-600">Type</p>
                    <p class="font-semibold text-gray-800 capitalize">${item.item_type}</p>
                </div>
                <span class="text-xs font-semibold ${statusBadgeClass[item.status] || 'bg-gray-100 text-gray-800'} px-3 py-1 rounded">
                    ${item.status.toUpperCase()}
                </span>
            </div>
            ${item.category ? `<div><p class="text-sm text-gray-600">Category</p><p class="font-semibold text-gray-800">${item.category}</p></div>` : ''}
            <div><p class="text-sm text-gray-600">Description</p><p class="font-semibold text-gray-800">${item.description || 'N/A'}</p></div>
            ${item.location ? `<div><p class="text-sm text-gray-600">Location</p><p class="font-semibold text-gray-800">${item.location}</p></div>` : ''}
            ${item.item_date ? `<div><p class="text-sm text-gray-600">Date</p><p class="font-semibold text-gray-800">${new Date(item.item_date).toLocaleDateString()}</p></div>` : ''}
            ${item.contact_email ? `<div><p class="text-sm text-gray-600">Contact Email</p><p class="font-semibold text-gray-800">${item.contact_email}</p></div>` : ''}
            ${item.contact_phone ? `<div><p class="text-sm text-gray-600">Contact Phone</p><p class="font-semibold text-gray-800">${item.contact_phone}</p></div>` : ''}
        </div>
    `;

    if (isUserItems) {
        document.getElementById('editItemBtn').classList.remove('hidden');
        document.getElementById('deleteItemBtn').classList.remove('hidden');
        document.getElementById('markFoundBtn').classList.add('hidden');
        document.getElementById('markClaimedBtn').classList.add('hidden');
        document.getElementById('viewClaimsBtn').classList.add('hidden');
        document.getElementById('contactUserBtn').classList.add('hidden');
        document.getElementById('claimFoundBtn').classList.add('hidden');

        // Show mark as found button only for lost items
        if (item.item_type === 'lost' && item.status !== 'found' && item.status !== 'resolved') {
            document.getElementById('markFoundBtn').classList.remove('hidden');
            document.getElementById('markFoundBtn').onclick = () => markAsFound(item.id);
        }

        // Show mark as claimed button only for found items
        if (item.item_type === 'found' && item.status !== 'claimed') {
            document.getElementById('markClaimedBtn').classList.remove('hidden');
            document.getElementById('markClaimedBtn').onclick = () => markAsClaimed(item.id);
        }

        // Show view claims button for lost items
        if (item.item_type === 'lost') {
            document.getElementById('viewClaimsBtn').classList.remove('hidden');
            document.getElementById('viewClaimsBtn').onclick = () => showFoundClaims(item.id);
        }

        document.getElementById('editItemBtn').onclick = () => showEditModal(item);
        document.getElementById('deleteItemBtn').onclick = () => deleteItem(item.id);
    } else {
        document.getElementById('editItemBtn').classList.add('hidden');
        document.getElementById('deleteItemBtn').classList.add('hidden');
        document.getElementById('markFoundBtn').classList.add('hidden');
        document.getElementById('markClaimedBtn').classList.add('hidden');
        document.getElementById('viewClaimsBtn').classList.add('hidden');
        document.getElementById('contactUserBtn').classList.remove('hidden');
        document.getElementById('claimFoundBtn').classList.add('hidden');

        // Show claim found button for lost items
        if (item.item_type === 'lost' && item.status !== 'resolved') {
            document.getElementById('claimFoundBtn').classList.remove('hidden');
            document.getElementById('claimFoundBtn').onclick = () => showClaimFoundModal(item.id);
        }

        document.getElementById('contactUserBtn').onclick = () => {
            const mailtoLink = `mailto:${item.contact_email}?subject=Regarding: ${item.title}`;
            window.location.href = mailtoLink;
        };
    }

    modal.classList.remove('hidden');
}

// Close Modal
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('itemModal').classList.add('hidden');
    });
});

// Show Edit Modal
function showEditModal(item) {
    currentEditingItem = item;
    document.getElementById('editItemId').value = item.id;
    document.getElementById('editItemType').value = item.item_type;
    document.getElementById('editItemCategory').value = item.category || '';
    document.getElementById('editItemTitle').value = item.title;
    document.getElementById('editItemDescription').value = item.description || '';
    document.getElementById('editItemLocation').value = item.location || '';
    document.getElementById('editItemStatus').value = item.status;

    document.getElementById('itemModal').classList.add('hidden');
    document.getElementById('editModal').classList.remove('hidden');
}

// Edit Item Form
document.getElementById('editItemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editItemId').value;

    try {
        const res = await fetch(`${API_BASE}/items/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                title: document.getElementById('editItemTitle').value,
                description: document.getElementById('editItemDescription').value,
                item_type: document.getElementById('editItemType').value,
                category: document.getElementById('editItemCategory').value,
                location: document.getElementById('editItemLocation').value,
                status: document.getElementById('editItemStatus').value,
                item_date: currentEditingItem.item_date,
                contact_email: currentEditingItem.contact_email,
                contact_phone: currentEditingItem.contact_phone
            })
        });

        const data = await res.json();
        if (!res.ok) {
            showToast(data.message, true);
            return;
        }

        showToast('Item updated successfully!');
        document.getElementById('editModal').classList.add('hidden');
        loadMyItems();
    } catch (error) {
        showToast('Error updating item', true);
    }
});

// Close Edit Modal
document.querySelectorAll('.close-edit-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('editModal').classList.add('hidden');
    });
});

// Delete Item
async function deleteItem(itemId) {
    if (!confirm('Are you sure you want to delete this item?')) return;

    try {
        const res = await fetch(`${API_BASE}/items/${itemId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });

        const data = await res.json();
        if (!res.ok) {
            showToast(data.message, true);
            return;
        }

        showToast('Item deleted successfully!');
        document.getElementById('itemModal').classList.add('hidden');
        loadMyItems();
    } catch (error) {
        showToast('Error deleting item', true);
    }
}

// Add Item Form
document.getElementById('addItemForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        const res = await fetch(`${API_BASE}/items`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                title: document.getElementById('itemTitle').value,
                description: document.getElementById('itemDescription').value,
                item_type: document.getElementById('itemType').value,
                category: document.getElementById('itemCategory').value,
                location: document.getElementById('itemLocation').value,
                item_date: document.getElementById('itemDate').value,
                contact_email: document.getElementById('itemContactEmail').value,
                contact_phone: document.getElementById('itemContactPhone').value
            })
        });

        const data = await res.json();
        if (!res.ok) {
            showToast(data.message, true);
            return;
        }

        showToast('Item posted successfully!');
        document.getElementById('addItemForm').reset();
        loadBrowseItems();
    } catch (error) {
        showToast('Error adding item', true);
    }
});

// Filter Items
document.getElementById('filterBtn').addEventListener('click', async () => {
    const search = document.getElementById('searchInput').value;
    const type = document.getElementById('typeFilter').value;
    const status = document.getElementById('statusFilter').value;

    let url = `${API_BASE}/items?`;
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (type) url += `type=${type}&`;
    if (status) url += `status=${status}&`;

    try {
        const res = await fetch(url);
        const items = await res.json();
        displayItems(items, 'itemsList');
    } catch (error) {
        console.error('Error filtering items:', error);
    }
});

// Toast Notification
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `hidden fixed bottom-4 right-4 p-4 rounded-lg text-white font-semibold shadow-lg z-50 ${isError ? 'bg-red-600' : 'bg-green-600'}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 6000);
}

// Mark Lost Item as Found
async function markAsFound(itemId) {
    if (!confirm('Mark this item as found?')) return;

    try {
        const res = await fetch(`${API_BASE}/items/${itemId}/mark-found`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });

        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || 'Error marking item as found', true);
            return;
        }

        showToast('Item marked as found!');
        document.getElementById('itemModal').classList.add('hidden');
        loadMyItems();
    } catch (error) {
        showToast('Error marking item as found', true);
    }
}

// Mark Found Item as Claimed
async function markAsClaimed(itemId) {
    if (!confirm('Mark this item as claimed?')) return;

    try {
        const res = await fetch(`${API_BASE}/items/${itemId}/mark-claimed`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });

        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || 'Error marking item as claimed', true);
            return;
        }

        showToast('Item marked as claimed!');
        document.getElementById('itemModal').classList.add('hidden');
        loadMyItems();
    } catch (error) {
        showToast('Error marking item as claimed', true);
    }
}

// Show Found Claims Modal
async function showFoundClaims(itemId) {
    try {
        const res = await fetch(`${API_BASE}/found-claims/item/${itemId}`);
        const claims = await res.json();

        const claimsContent = document.getElementById('claimsContent');
        if (claims.length === 0) {
            claimsContent.innerHTML = '<p class="text-center text-gray-600">No claims yet for this item</p>';
        } else {
            claimsContent.innerHTML = claims.map(claim => `
                <div class="border rounded-lg p-4 space-y-2">
                    <div class="flex justify-between items-start">
                        <div>
                            <h4 class="font-semibold text-gray-800">${claim.name}</h4>
                            <p class="text-sm text-gray-600">${claim.email}</p>
                        </div>
                        <span class="text-xs font-semibold ${
                            claim.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            claim.status === 'accepted' ? 'bg-green-100 text-green-800' :
                            'bg-red-100 text-red-800'
                        } px-3 py-1 rounded">
                            ${claim.status.toUpperCase()}
                        </span>
                    </div>
                    <div>
                        <p class="text-sm text-gray-600">Description</p>
                        <p class="text-sm text-gray-800">${claim.description}</p>
                    </div>
                    <div>
                        <p class="text-sm text-gray-600">Location Found</p>
                        <p class="text-sm text-gray-800">${claim.location}</p>
                    </div>
                    ${claim.contact_phone ? `<div class="text-sm text-gray-600">Phone: ${claim.contact_phone}</div>` : ''}
                    ${claim.status === 'pending' ? `
                        <div class="flex space-x-2">
                            <button class="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700" onclick="acceptClaim(${claim.id})">
                                Accept
                            </button>
                            <button class="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700" onclick="rejectClaim(${claim.id})">
                                Reject
                            </button>
                        </div>
                    ` : ''}
                </div>
            `).join('');
        }

        document.getElementById('claimsModal').classList.remove('hidden');
    } catch (error) {
        console.error('Error loading claims:', error);
        showToast('Error loading claims', true);
    }
}

// Accept a Found Claim
async function acceptClaim(claimId) {
    try {
        const res = await fetch(`${API_BASE}/found-claims/${claimId}/accept`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });

        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || 'Error accepting claim', true);
            return;
        }

        showToast('Claim accepted and 10 points awarded!');
        loadUserPoints();
        document.getElementById('claimsModal').classList.add('hidden');
        document.getElementById('itemModal').classList.add('hidden');
        loadBrowseItems();
    } catch (error) {
        showToast('Error accepting claim', true);
    }
}

// Reject a Found Claim
async function rejectClaim(claimId) {
    if (!confirm('Are you sure you want to reject this claim?')) return;

    try {
        const res = await fetch(`${API_BASE}/found-claims/${claimId}/reject`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });

        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || 'Error rejecting claim', true);
            return;
        }

        showToast('Claim rejected');
        document.getElementById('claimsModal').classList.add('hidden');
    } catch (error) {
        showToast('Error rejecting claim', true);
    }
}

// Show Claim Found Modal
function showClaimFoundModal(itemId) {
    document.getElementById('claimOriginalItemId').value = itemId;
    document.getElementById('claimEmail').value = currentUser.email || '';
    document.getElementById('itemModal').classList.add('hidden');
    document.getElementById('claimFoundModal').classList.remove('hidden');
}

// Close Claims Modal
document.querySelectorAll('.close-claims-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('claimsModal').classList.add('hidden');
    });
});

// Close Claim Found Modal
document.querySelectorAll('.close-claim-found-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById('claimFoundModal').classList.add('hidden');
    });
});

// Submit Found Claim
document.getElementById('claimFoundForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const itemId = document.getElementById('claimOriginalItemId').value;
    const description = document.getElementById('claimDescription').value;
    const location = document.getElementById('claimLocation').value;
    const email = document.getElementById('claimEmail').value;
    const phone = document.getElementById('claimPhone').value;

    try {
        const res = await fetch(`${API_BASE}/found-claims`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`
            },
            body: JSON.stringify({
                original_item_id: itemId,
                description,
                location,
                contact_email: email,
                contact_phone: phone
            })
        });

        const data = await res.json();
        if (!res.ok) {
            showToast(data.message || 'Error submitting claim', true);
            return;
        }

        showToast('Found claim submitted successfully! The item owner will contact you soon.');
        document.getElementById('claimFoundForm').reset();
        document.getElementById('claimFoundModal').classList.add('hidden');
        loadBrowseItems();
    } catch (error) {
        showToast('Error submitting claim', true);
    }
});
