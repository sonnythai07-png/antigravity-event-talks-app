// Global Application State
let allUpdates = [];
let filteredUpdates = [];
let selectedUpdate = null;
let currentCategory = 'all';
let searchQuery = '';
let sortOrder = 'desc'; // 'desc' = newest first, 'asc' = oldest first
let lastSyncedTime = null;

// DOM Elements
const refreshBtn = document.getElementById('refresh-btn');
const exportCsvBtn = document.getElementById('export-csv-btn');
const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const tabButtons = document.querySelectorAll('.tab-btn');
const sortBtn = document.getElementById('sort-btn');
const sortLabel = document.getElementById('sort-label');
const statusContainer = document.getElementById('status-container');
const loadingSpinner = document.getElementById('loading-spinner');
const emptyState = document.getElementById('empty-state');
const errorState = document.getElementById('error-state');
const errorMessage = document.getElementById('error-message');
const retryBtn = document.getElementById('retry-btn');
const releasesList = document.getElementById('releases-list');
const syncInfo = document.getElementById('sync-info');

// Composer DOM Elements
const composerPlaceholder = document.getElementById('composer-placeholder');
const composerActive = document.getElementById('composer-active');
const closeComposer = document.getElementById('close-composer');
const refBadge = document.getElementById('ref-badge');
const refDate = document.getElementById('ref-date');
const refText = document.getElementById('ref-text');
const tweetTextarea = document.getElementById('tweet-textarea');
const charCount = document.getElementById('char-count');
const progressCircle = document.getElementById('progress-circle');
const resetTweetBtn = document.getElementById('reset-tweet-btn');
const mockupText = document.getElementById('mockup-text');
const copyTweetBtn = document.getElementById('copy-tweet-btn');
const copyBtnText = document.getElementById('copy-btn-text');
const postTweetBtn = document.getElementById('post-tweet-btn');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Initialize Progress Ring Math
const circleRadius = 8;
const circleCircumference = 2 * Math.PI * circleRadius;
if (progressCircle) {
    progressCircle.style.strokeDasharray = `${circleCircumference} ${circleCircumference}`;
    progressCircle.style.strokeDashoffset = circleCircumference;
}

// -------------------------------------------------------------
// Initialization & Data Fetching
// -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    fetchReleaseNotes(false);
    setupEventListeners();
});

function setupEventListeners() {
    // Export Action
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', exportToCSV);
    }

    // Refresh Actions
    refreshBtn.addEventListener('click', () => fetchReleaseNotes(true));
    retryBtn.addEventListener('click', () => fetchReleaseNotes(true));

    // Search Actions
    searchInput.addEventListener('input', handleSearch);
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        handleSearch();
    });

    // Tab Actions
    tabButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategory = btn.dataset.category;
            filterAndRenderUpdates();
        });
    });

    // Sort Action
    sortBtn.addEventListener('click', toggleSort);

    // Composer Actions
    closeComposer.addEventListener('click', deselectUpdate);
    tweetTextarea.addEventListener('input', handleTweetEdit);
    resetTweetBtn.addEventListener('click', resetTweetDraft);
    copyTweetBtn.addEventListener('click', copyTweetToClipboard);
    postTweetBtn.addEventListener('click', postToTwitter);
}

async function fetchReleaseNotes(forceRefresh = false) {
    showLoading();
    deselectUpdate();
    
    // Animate refresh icon
    const refreshIcon = refreshBtn.querySelector('.icon-refresh');
    if (refreshIcon) refreshIcon.classList.add('spinning');
    refreshBtn.disabled = true;

    try {
        const url = `/api/releases${forceRefresh ? '?refresh=true' : ''}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.details || data.error);
        }

        // Process RSS/Atom entries to individual sub-updates
        allUpdates = processEntries(data.entries);
        lastSyncedTime = new Date(data.last_fetched * 1000);
        updateSyncTimeDisplay();
        
        filterAndRenderUpdates();
    } catch (error) {
        console.error('Fetch error:', error);
        showError(error.message);
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('spinning');
        refreshBtn.disabled = false;
    }
}

// -------------------------------------------------------------
// Feed Processing & Parsing
// -------------------------------------------------------------

function processEntries(entries) {
    const processedUpdates = [];
    
    entries.forEach(entry => {
        const date = entry.title; // e.g. "July 01, 2026"
        const updated = entry.updated;
        const link = entry.link || 'https://cloud.google.com/bigquery/docs/release-notes';
        const htmlContent = entry.content;
        
        if (!htmlContent) return;
        
        // Parse the HTML content
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        
        // Find all h3 tags (which represent update types like Feature, Change, Deprecated, etc.)
        const h3s = Array.from(doc.querySelectorAll('h3'));
        
        if (h3s.length === 0) {
            // Fallback: treat the whole content as one update
            const textContent = doc.body.textContent || '';
            processedUpdates.push({
                id: entry.id,
                date: date,
                updated: updated,
                type: 'Update',
                contentHtml: formatContentLinks(htmlContent),
                contentText: textContent.trim(),
                link: link
            });
            return;
        }
        
        h3s.forEach((h3, index) => {
            const type = h3.textContent.trim();
            let contentHtml = '';
            let sibling = h3.nextElementSibling;
            
            // Gather all siblings until the next h3
            while (sibling && sibling.tagName !== 'H3') {
                contentHtml += sibling.outerHTML;
                sibling = sibling.nextElementSibling;
            }
            
            // Clean content links so they open in new tab
            const cleanedHtml = formatContentLinks(contentHtml);
            
            // Create a plain text version for Twitter drafting
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = contentHtml;
            const contentText = tempDiv.textContent || tempDiv.innerText || '';
            
            processedUpdates.push({
                id: `${entry.id}#sub-${index}`,
                date: date,
                updated: updated,
                type: type,
                contentHtml: cleanedHtml,
                contentText: contentText.trim(),
                link: link
            });
        });
    });
    
    return processedUpdates;
}

// Ensure all links in the release content open in a new tab
function formatContentLinks(htmlStr) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = htmlStr;
    const links = tempDiv.querySelectorAll('a');
    links.forEach(a => {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
    });
    return tempDiv.innerHTML;
}

// -------------------------------------------------------------
// UI State Controls (Loading, Error, Display)
// -------------------------------------------------------------

function showLoading() {
    statusContainer.style.display = 'flex';
    loadingSpinner.style.display = 'flex';
    emptyState.style.display = 'none';
    errorState.style.display = 'none';
    releasesList.style.display = 'none';
}

function showError(msg) {
    statusContainer.style.display = 'flex';
    loadingSpinner.style.display = 'none';
    emptyState.style.display = 'none';
    errorState.style.display = 'flex';
    errorMessage.textContent = msg;
    releasesList.style.display = 'none';
}

function showEmpty() {
    statusContainer.style.display = 'flex';
    loadingSpinner.style.display = 'none';
    emptyState.style.display = 'flex';
    errorState.style.display = 'none';
    releasesList.style.display = 'none';
}

function showContent() {
    statusContainer.style.display = 'none';
    releasesList.style.display = 'flex';
}

function updateSyncTimeDisplay() {
    if (!lastSyncedTime) {
        syncInfo.textContent = 'Last synced: Never';
        return;
    }
    const timeStr = lastSyncedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    syncInfo.textContent = `Last synced: Today at ${timeStr}`;
}

// -------------------------------------------------------------
// Search, Filter, & Sort Logic
// -------------------------------------------------------------

function handleSearch() {
    searchQuery = searchInput.value.toLowerCase().trim();
    
    // Toggle clear button visibility
    if (searchQuery) {
        clearSearchBtn.style.display = 'block';
    } else {
        clearSearchBtn.style.display = 'none';
    }
    
    filterAndRenderUpdates();
}

function toggleSort() {
    if (sortOrder === 'desc') {
        sortOrder = 'asc';
        sortLabel.textContent = 'Oldest First';
        sortBtn.classList.add('asc');
    } else {
        sortOrder = 'desc';
        sortLabel.textContent = 'Newest First';
        sortBtn.classList.remove('asc');
    }
    filterAndRenderUpdates();
}

function filterAndRenderUpdates() {
    // 1. Category Filtering
    filteredUpdates = allUpdates.filter(update => {
        if (currentCategory === 'all') return true;
        
        const typeLower = update.type.toLowerCase();
        if (currentCategory === 'feature') return typeLower === 'feature';
        if (currentCategory === 'change') return typeLower === 'change';
        
        // 'other' includes Deprecated, Known issue, Support, etc.
        return typeLower !== 'feature' && typeLower !== 'change';
    });

    // 2. Search Filtering
    if (searchQuery) {
        filteredUpdates = filteredUpdates.filter(update => {
            return update.date.toLowerCase().includes(searchQuery) ||
                   update.type.toLowerCase().includes(searchQuery) ||
                   update.contentText.toLowerCase().includes(searchQuery);
        });
    }

    // 3. Sorting
    filteredUpdates.sort((a, b) => {
        // Fallback comparison using raw 'updated' string (ISO datetime structure)
        const dateA = new Date(a.updated || a.date);
        const dateB = new Date(b.updated || b.date);
        
        if (sortOrder === 'desc') {
            return dateB - dateA;
        } else {
            return dateA - dateB;
        }
    });

    // Render
    renderUpdatesList();
}

function renderUpdatesList() {
    releasesList.innerHTML = '';
    
    if (filteredUpdates.length === 0) {
        showEmpty();
        return;
    }
    
    showContent();
    
    filteredUpdates.forEach(update => {
        const card = document.createElement('div');
        card.className = `release-card ${selectedUpdate && selectedUpdate.id === update.id ? 'selected' : ''}`;
        card.dataset.id = update.id;
        
        // Define badge style class
        const typeLower = update.type.toLowerCase();
        let badgeClass = 'badge-other';
        if (typeLower === 'feature') badgeClass = 'badge-feature';
        else if (typeLower === 'change') badgeClass = 'badge-change';
        else if (typeLower === 'deprecated' || typeLower === 'known issue') badgeClass = 'badge-deprecated';

        card.innerHTML = `
            <div class="card-header">
                <span class="badge ${badgeClass}">${update.type}</span>
                <div class="flex-center" style="gap: 10px;">
                    <span class="card-date">${update.date}</span>
                    <button class="card-copy-btn flex-center" title="Copy update text">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="card-body">
                ${update.contentHtml}
            </div>
            <div class="select-indicator">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>
        `;
        
        const copyBtn = card.querySelector('.card-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Avoid selecting the card
                const textToCopy = `[${update.date}] ${update.type}: ${update.contentText}`;
                navigator.clipboard.writeText(textToCopy).then(() => {
                    showToast('Copied update to clipboard!');
                    
                    // Simple visual feedback
                    const origInner = copyBtn.innerHTML;
                    copyBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" fill="none" stroke="#4285F4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    `;
                    setTimeout(() => {
                        copyBtn.innerHTML = origInner;
                    }, 2000);
                }).catch(err => {
                    console.error('Failed to copy card text:', err);
                    showToast('Failed to copy text.');
                });
            });
        }
        
        card.addEventListener('click', () => selectUpdate(update));
        releasesList.appendChild(card);
    });
}

// -------------------------------------------------------------
// Selection & Tweet Composer Logic
// -------------------------------------------------------------

function selectUpdate(update) {
    selectedUpdate = update;
    
    // Highlight selected card in DOM
    document.querySelectorAll('.release-card').forEach(card => {
        if (card.dataset.id === update.id) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });

    // Populate Composer reference section
    refBadge.textContent = update.type;
    refBadge.className = 'badge';
    
    const typeLower = update.type.toLowerCase();
    if (typeLower === 'feature') refBadge.classList.add('badge-feature');
    else if (typeLower === 'change') refBadge.classList.add('badge-change');
    else if (typeLower === 'deprecated' || typeLower === 'known issue') refBadge.classList.add('badge-deprecated');
    else refBadge.classList.add('badge-other');

    refDate.textContent = update.date;
    refText.textContent = update.contentText;

    // Show Composer, Hide Placeholder
    composerPlaceholder.style.display = 'none';
    composerActive.style.display = 'flex';

    // Generate Default Tweet
    resetTweetDraft();
}

function deselectUpdate() {
    selectedUpdate = null;
    document.querySelectorAll('.release-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    composerActive.style.display = 'none';
    composerPlaceholder.style.display = 'flex';
}

function generateDefaultTweetText(update) {
    const icon = update.type.toLowerCase() === 'feature' ? '🚀' : '⚙️';
    
    // Construct tweet body
    const header = `${icon} New #BigQuery Update (${update.date}):\n\n`;
    const hashtags = `\n\n#GoogleCloud #DataEngineering #CloudComputing`;
    const linkText = `\nRead more: ${update.link}`;
    
    // Calculate space left for the main description content
    // Standard Tweet Limit is 280 chars
    const baseLength = header.length + linkText.length + hashtags.length;
    const allowedDescLength = 280 - baseLength - 5; // offset for "..." truncation
    
    let descriptionText = update.contentText;
    if (descriptionText.length > allowedDescLength) {
        descriptionText = descriptionText.substring(0, allowedDescLength).trim() + '...';
    }
    
    return `${header}${update.type}: ${descriptionText}${linkText}${hashtags}`;
}

function resetTweetDraft() {
    if (!selectedUpdate) return;
    const defaultText = generateDefaultTweetText(selectedUpdate);
    tweetTextarea.value = defaultText;
    updateTweetPreviews(defaultText);
}

function handleTweetEdit(e) {
    updateTweetPreviews(e.target.value);
}

function updateTweetPreviews(text) {
    // 1. Update Mockup Text
    // Replaces URLs with links in X style, hashtags with active color styles, etc.
    let previewHtml = escapeHtml(text);
    
    // Basic regex for styling URLs
    const urlPattern = /(https?:\/\/[^\s]+)/g;
    previewHtml = previewHtml.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Basic regex for hashtags
    const hashtagPattern = /(#[a-zA-Z0-9_]+)/g;
    previewHtml = previewHtml.replace(hashtagPattern, '<span style="color:#1d9bf0;">$1</span>');
    
    mockupText.innerHTML = previewHtml;

    // 2. Update Character Counter & Progress Circle
    const currentLength = text.length;
    const remaining = 280 - currentLength;
    charCount.textContent = remaining;

    const counterContainer = document.querySelector('.character-counter');
    counterContainer.classList.remove('warning', 'error');
    
    if (remaining <= 20 && remaining >= 0) {
        counterContainer.classList.add('warning');
    } else if (remaining < 0) {
        counterContainer.classList.add('error');
    }

    // 3. Update Progress SVG Ring
    const percentage = Math.min(100, (currentLength / 280) * 100);
    const strokeColor = remaining < 0 ? '#ff3b30' : (remaining <= 20 ? '#ffcc00' : '#4285F4');
    
    progressCircle.style.stroke = strokeColor;
    
    // Offset calculation: circleCircumference (empty) to 0 (full)
    const offset = circleCircumference - (percentage / 100) * circleCircumference;
    progressCircle.style.strokeDashoffset = offset;

    // Enable/Disable Post Button
    postTweetBtn.disabled = currentLength === 0 || remaining < 0;
    copyTweetBtn.disabled = currentLength === 0;
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// -------------------------------------------------------------
// Copy & Share Operations
// -------------------------------------------------------------

function copyTweetToClipboard() {
    const text = tweetTextarea.value;
    if (!text) return;
    
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied tweet to clipboard!');
        
        // Temporarily animate copy button
        copyBtnText.textContent = 'Copied!';
        copyTweetBtn.classList.add('btn-primary');
        copyTweetBtn.classList.remove('btn-secondary');
        
        setTimeout(() => {
            copyBtnText.textContent = 'Copy Text';
            copyTweetBtn.classList.remove('btn-primary');
            copyTweetBtn.classList.add('btn-secondary');
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy: ', err);
        showToast('Failed to copy text.');
    });
}

function postToTwitter() {
    const text = tweetTextarea.value;
    if (!text) return;
    
    const remaining = 280 - text.length;
    if (remaining < 0) {
        showToast('Tweet is too long! Please shorten it first.');
        return;
    }

    const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(shareUrl, '_blank', 'width=550,height=420,toolbar=0,status=0');
}

function showToast(message) {
    toastMessage.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function exportToCSV() {
    if (filteredUpdates.length === 0) {
        showToast('No updates to export.');
        return;
    }
    
    const headers = ['Date', 'Type', 'Content', 'Link'];
    const csvRows = [headers.join(',')];
    
    filteredUpdates.forEach(update => {
        const dateEscaped = `"${update.date.replace(/"/g, '""')}"`;
        const typeEscaped = `"${update.type.replace(/"/g, '""')}"`;
        const contentEscaped = `"${update.contentText.replace(/"/g, '""')}"`;
        const linkEscaped = `"${update.link.replace(/"/g, '""')}"`;
        
        csvRows.push([dateEscaped, typeEscaped, contentEscaped, linkEscaped].join(','));
    });
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    
    const catStr = currentCategory !== 'all' ? `_${currentCategory}` : '';
    const dateStr = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `bigquery_releases_${dateStr}${catStr}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast('CSV export downloaded!');
}
