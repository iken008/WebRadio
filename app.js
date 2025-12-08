const BASE_URL = 'https://de1.api.radio-browser.info/json/stations/search?';
const JAPAN_LANGUAGE = 'japanese';

let currentCountry = 'US';
let currentTag = '';
let currentSearchTerm = '';
let animationFrameId;
let showFavoritesOnly = false;

// DOM element references
const countrySelect = document.getElementById('country');
const searchInput = document.getElementById('search-input');
const genreButtons = document.querySelectorAll('.genre-btn');
const stationListElement = document.getElementById('station-list');
const stationInfoElement = document.getElementById('station-info');
const audioPlayer = document.getElementById('audio-player');
const canvas = document.getElementById('waveform-canvas');
const ctx = canvas.getContext('2d');
const volumeControl = document.getElementById('volume-control');
const volumeValue = document.getElementById('volume-value');
const favFilterBtn = document.getElementById('fav-filter-btn');
const muteBtn = document.getElementById('mute-btn');

let isMuted = false;
let volumeBeforeMute = 100;

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

// --- API Calls and List Rendering ---

async function fetchStations() {
    stationListElement.innerHTML = '<div class="loading">📡 Searching...</div>';

    // Set language filter to Japanese for Japan, English for others
    const languageFilter = (currentCountry === 'JP') ? JAPAN_LANGUAGE : 'english';

    // Build API query parameters
    const queryParams = new URLSearchParams({
        countrycode: currentCountry,
        tag: currentTag,
        name: currentSearchTerm,
        language: languageFilter,
        hidebroken: 'true',
        limit: 50,
        order: 'votes',
        reverse: 'true'
    });

    try {
        const url = `${BASE_URL}${queryParams.toString()}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const stations = await response.json();

        renderStationList(stations, stationListElement);
    } catch (error) {
        console.error("Error fetching stations:", error);
        stationListElement.innerHTML = '<p class="error-message">Failed to fetch data.</p>';
    }
}

/**
 * Render station list to HTML element
 * @param {Array} stations - Array of station objects
 * @param {HTMLElement} targetElement - Target DOM element
 */
function renderStationList(stations, targetElement) {
    targetElement.innerHTML = '';

    // Filter by favorites if enabled
    if (showFavoritesOnly) {
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
    });

    stationInfoElement.innerHTML = `
        <div class="now-playing">
            <p>🔊 NOW PLAYING:</p>
            <p class="current-station-name">${name}</p>
        </div>
    `;

    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    drawWaveform();
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
    animationFrameId = requestAnimationFrame(drawWaveform);
}


// --- Event Listeners ---

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

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Restore saved volume
    const savedVolume = loadVolume();
    volumeControl.value = savedVolume;
    audioPlayer.volume = savedVolume / 100;
    volumeValue.textContent = `${savedVolume}%`;

    fetchStations();
    drawWaveform();
});