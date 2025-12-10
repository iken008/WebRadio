const JAPAN_LANGUAGE = 'japanese';
const SERVER_LIST_URL = 'https://all.api.radio-browser.info/json/servers';

let baseUrl = null; // Will be set dynamically
let currentCountry = ''; // Empty = All countries
let currentTag = '';
let currentSearchTerm = '';
let animationFrameId;
let showFavoritesOnly = false;

// DOM element references - will be initialized in DOMContentLoaded
let countrySelect;
let searchInput;
let genreButtons;
let stationListElement;
let stationInfoElement;
let audioPlayer;
let canvas;
let ctx;
let volumeControl;
let volumeValue;
let favFilterBtn;
let muteBtn;

let isMuted = false;
let volumeBeforeMute = 100;
let currentStationName = '';

// Check if device is mobile
function isMobileDevice() {
    // Match CSS media query breakpoint
    return window.innerWidth <= 480;
}

// --- localStorage Management ---

function saveVolume(volume) {
    localStorage.setItem('radioVolume', volume);
}

function loadVolume() {
    const saved = localStorage.getItem('radioVolume');
    return saved !== null ? parseInt(saved) : 100;
}

function saveFavorites(favorites) {
    localStorage.setItem('radioFavorites', JSON.stringify(favorites));
}

function loadFavorites() {
    try {
        const saved = localStorage.getItem('radioFavorites');
        const parsed = saved ? JSON.parse(saved) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        console.error('Error loading favorites:', e);
        return [];
    }
}

function toggleFavorite(stationUuid) {
    let favorites = loadFavorites();
    const index = favorites.indexOf(stationUuid);

    if (index > -1) {
        favorites.splice(index, 1);
    } else {
        favorites.push(stationUuid);
    }

    saveFavorites(favorites);
    return favorites.includes(stationUuid);
}

function isFavorite(stationUuid) {
    return loadFavorites().includes(stationUuid);
}

// --- Server Selection and Caching ---

function saveServer(serverName) {
    localStorage.setItem('radioServerName', serverName);
}

function loadServer() {
    return localStorage.getItem('radioServerName');
}

async function selectRadioServer(forceNew = false) {
    // Use cached server if available and not forcing new selection
    if (!forceNew) {
        const cached = loadServer();
        if (cached) {
            baseUrl = `https://${cached}/json/stations/search?`;
            return cached;
        }
    }

    try {
        const response = await fetch(SERVER_LIST_URL);
        if (!response.ok) throw new Error('Failed to fetch server list');

        const servers = await response.json();
        if (!servers || servers.length === 0) {
            throw new Error('No servers available');
        }

        // Select random server from the list
        const randomServer = servers[Math.floor(Math.random() * servers.length)];
        const serverName = randomServer.name;

        baseUrl = `https://${serverName}/json/stations/search?`;
        saveServer(serverName);

        console.log(`Using Radio Browser server: ${serverName}`);
        return serverName;
    } catch (error) {
        console.error('Error selecting server:', error);
        // Fallback to default server
        const fallbackServer = 'de1.api.radio-browser.info';
        baseUrl = `https://${fallbackServer}/json/stations/search?`;
        saveServer(fallbackServer);
        return fallbackServer;
    }
}

function getStationByUuidUrl(uuid) {
    const serverName = loadServer() || 'de1.api.radio-browser.info';
    return `https://${serverName}/json/stations/byuuid/${uuid}`;
}

// --- API Calls and List Rendering ---

async function fetchStations(retryWithNewServer = true) {
    stationListElement.innerHTML = '<div class="loading">📡 Searching...</div>';

    // Ensure server is selected
    if (!baseUrl) {
        await selectRadioServer();
    }

    // If showing favorites only and country is "All", fetch favorite stations by UUID
    if (showFavoritesOnly && currentCountry === '') {
        await fetchFavoriteStations();
        return;
    }

    // Set language filter based on country
    let languageFilter = '';
    if (currentCountry === 'JP') {
        languageFilter = JAPAN_LANGUAGE;
    } else if (currentCountry && currentCountry !== '') {
        // English-speaking countries: US, GB, AU, CA
        languageFilter = 'english';
    }
    // If currentCountry is empty (All), no language filter

    // Build API query parameters
    const params = {
        tag: currentTag,
        name: currentSearchTerm,
        hidebroken: 'true',
        limit: 50,
        order: 'votes',
        reverse: 'true'
    };

    // Add optional parameters
    if (currentCountry) params.countrycode = currentCountry;
    if (languageFilter) params.language = languageFilter;

    const queryParams = new URLSearchParams(params);

    try {
        const url = `${baseUrl}${queryParams.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const stations = await response.json();

        renderStationList(stations, stationListElement);
    } catch (error) {
        console.error("Error fetching stations:", error);

        // Retry with a new server if this is the first attempt
        if (retryWithNewServer) {
            console.log("Retrying with a different server...");
            await selectRadioServer(true); // Force new server selection
            await fetchStations(false); // Retry once with new server
        } else {
            stationListElement.innerHTML = '<p class="error-message">Failed to fetch data.</p>';
        }
    }
}

async function fetchFavoriteStations() {
    const favorites = loadFavorites();

    if (favorites.length === 0) {
        stationListElement.innerHTML = '<p class="no-results">No favorites yet.</p>';
        return;
    }

    // Ensure server is selected
    if (!baseUrl) {
        await selectRadioServer();
    }

    try {
        // Fetch each favorite station by UUID
        const stationPromises = favorites.map(uuid =>
            fetch(getStationByUuidUrl(uuid))
                .then(res => res.json())
                .catch(err => {
                    console.error(`Failed to fetch station ${uuid}:`, err);
                    return null;
                })
        );

        const stationsArrays = await Promise.all(stationPromises);
        // Flatten and filter out null results
        const stations = stationsArrays.flat().filter(s => s !== null);

        renderStationList(stations, stationListElement, true);
    } catch (error) {
        console.error("Error fetching favorite stations:", error);
        stationListElement.innerHTML = '<p class="error-message">Failed to fetch favorites.</p>';
    }
}

/**
 * Render station list to HTML element
 * @param {Array} stations - Array of station objects
 * @param {HTMLElement} targetElement - Target DOM element
 * @param {boolean} skipFavoriteFilter - Skip favorite filtering (already filtered)
 */
function renderStationList(stations, targetElement, skipFavoriteFilter = false) {
    targetElement.innerHTML = '';

    // Filter by favorites if enabled (unless already filtered)
    if (showFavoritesOnly && !skipFavoriteFilter) {
        const favorites = loadFavorites();
        stations = stations.filter(s => favorites.includes(s.stationuuid));
    }

    if (stations.length === 0) {
        const msg = showFavoritesOnly
            ? '<p class="no-results">No favorites yet.</p>'
            : '<p class="no-results">No stations found.</p>';
        targetElement.innerHTML = msg;
        return;
    }

    stations.forEach(station => {
        const listItem = document.createElement('div');
        listItem.className = 'station-item';

        const isFav = isFavorite(station.stationuuid);

        listItem.innerHTML = `
            <div class="station-info-wrapper">
                <span class="station-name">${station.name}</span>
                <span class="station-tag">${station.tags.split(',').slice(0, 2).join(', ')}</span>
            </div>
            <button class="fav-btn ${isFav ? 'favorited' : ''}" data-uuid="${station.stationuuid}">★</button>
        `;

        // Favorite button event
        const favBtn = listItem.querySelector('.fav-btn');
        favBtn.onclick = (e) => {
            e.stopPropagation();
            const nowFav = toggleFavorite(station.stationuuid);
            favBtn.classList.toggle('favorited', nowFav);
        };

        // Play on click (except favorite button)
        listItem.onclick = (e) => {
            if (!e.target.classList.contains('fav-btn')) {
                playStation(station.url_resolved, station.name);
            }
        };

        targetElement.appendChild(listItem);
    });
}

// --- Playback and Waveform Animation ---

function playStation(url, name) {
    currentStationName = name;
    audioPlayer.src = url;
    audioPlayer.play().catch(e => {
        console.error("Playback error:", e);
        // Hide the station item if playback fails
        const stationItems = document.querySelectorAll('.station-item');
        stationItems.forEach(item => {
            if (item.textContent.includes(name)) {
                item.style.display = 'none';
            }
        });
        stationInfoElement.innerHTML = '<p style="color: #ff6b6b;">⚠️ Failed to play. Trying another station...</p>';
        currentStationName = '';
        stopWaveform();
    });
}

function updateStationInfo(name, isPaused) {
    const isMobile = isMobileDevice();
    const screenWidth = window.innerWidth;
    console.log(`updateStationInfo called: isMobile=${isMobile}, screenWidth=${screenWidth}, isPaused=${isPaused}`);

    let icon, statusText;

    if (isMobile) {
        // Mobile: use speaker icons for play/pause states
        icon = isPaused ? '🔇' : '🔊';
        statusText = isPaused ? 'PAUSED' : 'NOW PLAYING';
    } else {
        // PC: use play/pause icons
        icon = isPaused ? '⏸️' : '▶️';
        statusText = isPaused ? 'PAUSED' : 'NOW PLAYING';
    }

    console.log(`Setting icon: ${icon}, statusText: ${statusText}`);

    stationInfoElement.innerHTML = `
        <div class="now-playing">
            <p>${icon} ${statusText}:</p>
            <p class="current-station-name">${name}</p>
        </div>
    `;
}

function togglePlayPause(e) {
    if (!audioPlayer.src) return;

    if (audioPlayer.paused) {
        audioPlayer.play().catch(e => {
            console.error("Play error:", e);
        });
    } else {
        audioPlayer.pause();
    }
}

function toggleMute() {
    if (isMuted) {
        // Unmute
        audioPlayer.volume = volumeBeforeMute / 100;
        volumeControl.value = volumeBeforeMute;
        volumeValue.textContent = `${volumeBeforeMute}%`;
        muteBtn.textContent = '🔊';
        isMuted = false;
    } else {
        // Mute
        volumeBeforeMute = volumeControl.value;
        audioPlayer.volume = 0;
        volumeControl.value = 0;
        volumeValue.textContent = '0%';
        muteBtn.textContent = '🔇';
        isMuted = true;
    }
}

// Waveform animation function
function drawWaveform() {
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const centerY = height / 2;
    const barCount = 18;
    const barWidth = width / barCount;

    for (let i = 0; i < barCount; i++) {
        const randomFactor = audioPlayer.paused ? 0.2 : 1;
        const barHeight = (Math.random() * height * 0.4 * randomFactor) + (height * 0.1);

        const x = i * barWidth;
        const yTop = centerY - barHeight / 2;
        const yBottom = centerY + barHeight / 2;

        ctx.moveTo(x + barWidth / 2, yTop);
        ctx.lineTo(x + barWidth / 2, yBottom);
    }

    ctx.stroke();

    // Continue animation only if playing
    if (!audioPlayer.paused) {
        animationFrameId = requestAnimationFrame(drawWaveform);
    }
}

// Start waveform animation
function startWaveform() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    drawWaveform();
}

// Stop waveform animation
function stopWaveform() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    // Draw static waveform
    drawStaticWaveform();
}

// Draw static waveform (for paused state)
function drawStaticWaveform() {
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 2;
    ctx.beginPath();

    const centerY = height / 2;
    const barCount = 18;
    const barWidth = width / barCount;

    for (let i = 0; i < barCount; i++) {
        const barHeight = height * 0.15; // Small static bars

        const x = i * barWidth;
        const yTop = centerY - barHeight / 2;
        const yBottom = centerY + barHeight / 2;

        ctx.moveTo(x + barWidth / 2, yTop);
        ctx.lineTo(x + barWidth / 2, yBottom);
    }

    ctx.stroke();
}


// --- Event Listeners Setup Function ---
function setupEventListeners() {
    // Station info area - click to play/pause
    stationInfoElement.addEventListener('click', (e) => {
        togglePlayPause(e);
    });

    // Update station info when audio play/pause state changes
    audioPlayer.addEventListener('play', () => {
        if (currentStationName) updateStationInfo(currentStationName, false);
        startWaveform();
    });

    audioPlayer.addEventListener('pause', () => {
        if (currentStationName) updateStationInfo(currentStationName, true);
        stopWaveform();
    });

    // Mute button
    muteBtn.addEventListener('click', toggleMute);

    // Volume control
    volumeControl.addEventListener('input', (e) => {
        const volume = e.target.value;
        audioPlayer.volume = volume / 100;
        volumeValue.textContent = `${volume}%`;
        saveVolume(volume);

        // Update mute state if manually adjusted
        if (volume > 0 && isMuted) {
            isMuted = false;
            muteBtn.textContent = '🔊';
        } else if (volume == 0 && !isMuted) {
            isMuted = true;
            muteBtn.textContent = '🔇';
        }
    });

    // Favorites filter
    favFilterBtn.addEventListener('click', () => {
        showFavoritesOnly = !showFavoritesOnly;
        favFilterBtn.classList.toggle('active', showFavoritesOnly);

        // Deactivate genre buttons when filtering favorites
        if (showFavoritesOnly) {
            genreButtons.forEach(btn => btn.classList.remove('active'));
        }

        fetchStations();
    });

    countrySelect.addEventListener('change', (e) => {
        currentCountry = e.target.value;
        fetchStations();
    });

    searchInput.addEventListener('input', () => {
        currentSearchTerm = searchInput.value;
        setTimeout(fetchStations, 500);
    });

    genreButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            // Clear favorites filter
            showFavoritesOnly = false;
            favFilterBtn.classList.remove('active');

            genreButtons.forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');

            currentTag = e.target.dataset.tag;
            fetchStations();
        });
    });
}

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
        console.error('Service Worker registration failed:', err);
    });
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Initialize DOM element references
    countrySelect = document.getElementById('country');
    searchInput = document.getElementById('search-input');
    genreButtons = document.querySelectorAll('.genre-btn');
    stationListElement = document.getElementById('station-list');
    stationInfoElement = document.getElementById('station-info');
    audioPlayer = document.getElementById('audio-player');
    canvas = document.getElementById('waveform-canvas');
    ctx = canvas.getContext('2d');
    volumeControl = document.getElementById('volume-control');
    volumeValue = document.getElementById('volume-value');
    favFilterBtn = document.getElementById('fav-filter-btn');
    muteBtn = document.getElementById('mute-btn');

    // Setup all event listeners
    setupEventListeners();

    // Restore saved volume
    const savedVolume = loadVolume();
    volumeControl.value = savedVolume;
    audioPlayer.volume = savedVolume / 100;
    volumeValue.textContent = `${savedVolume}%`;

    // Initialize server and fetch stations
    selectRadioServer().then(() => {
        fetchStations();
    });

    drawStaticWaveform();
});