const API_BASE = '/api';
let currentToken = localStorage.getItem('token');
let currentUser = JSON.parse(localStorage.getItem('user') || '{}');
let currentEditingItem = null;

// ============== DOM Elements ==============
const loginPage = document.getElementById('loginPage');
const dashboardPage = document.getElementById('dashboardPage');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const forgotPasswordForm = document.getElementById('forgotPasswordForm');
const otpSection = document.getElementById('otpSection');

// ============== Initial Load ==============
document.addEventListener('DOMContentLoaded', () => {
    if (currentToken) {
        showDashboard();
    }
});

// ============== Auth Functions ==============

// Show Message
function showAuthMessage(message, isError = false) {
    const messageDiv = document.getElementById('authMessage');
    messageDiv.textContent = message;
    messageDiv.className = `mt-6 p-3 rounded-lg ${isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`;
    messageDiv.classList.remove('hidden');
    setTimeout(() => messageDiv.classList.add('hidden'), 6000);
}

// Login
document.getElementById('loginSubmitBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
        showAuthMessage('Please fill all fields', true);
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
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
        showAuthMessage('Login failed', true);
    }
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

// Show/Hide Forms
document.getElementById('showSignupBtn').addEventListener('click', () => {
    loginForm.classList.add('hidden');
    signupForm.classList.remove('hidden');
});

document.getElementById('showLoginBtn').addEventListener('click', () => {
    signupForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
});

document.getElementById('showForgotPasswordBtn').addEventListener('click', () => {
    loginForm.classList.add('hidden');
    forgotPasswordForm.classList.remove('hidden');
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
        card.innerHTML = `
            <div class="bg-gradient-to-r ${item.item_type === 'lost' ? 'from-red-400 to-red-600' : 'from-green-400 to-green-600'} h-32 flex items-center justify-center">
                <i class="fas ${item.item_type === 'lost' ? 'fa-question-circle' : 'fa-check-circle'} text-white text-4xl"></i>
            </div>
            <div class="p-4">
                <div class="flex justify-between items-start mb-2">
                    <h3 class="font-bold text-lg text-gray-800">${item.title}</h3>
                    <span class="text-xs font-semibold ${item.item_type === 'lost' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'} px-2 py-1 rounded">
                        ${item.item_type.toUpperCase()}
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
