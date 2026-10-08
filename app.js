// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => console.log('Service Worker registered:', reg.scope))
      .catch((err) => console.warn('Service Worker registration skipped:', err));
  });
}

// Permanent Storage using IndexedDB
const DB_NAME = 'RishiMusicDB';
const DB_VERSION = 1;
const STORE_NAME = 'music_vault';
let db = null;

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };

    req.onerror = () => reject(req.error);
  });
}

function saveSong(blob, title, director) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item = {
      blob,
      title,
      director,
      lastPlayedDate: null
    };
    const req = store.add(item);
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

function getAllSongs() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function updateSong(id, title, director) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);

    req.onsuccess = () => {
      const data = req.result;
      if (!data) return reject(new Error('Song not found'));
      data.title = title;
      data.director = director;
      store.put(data);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function markSongPlayedToday(id) {
  return new Promise((resolve) => {
    const today = new Date().toISOString().slice(0, 10);
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);

    req.onsuccess = () => {
      const data = req.result;
      if (data) {
        data.lastPlayedDate = today;
        store.put(data);
      }
    };
    tx.oncomplete = () => resolve();
  });
}

function deleteSong(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// App State
let songs = [];
let currentSongIndex = -1;
let currentObjectUrl = null;

const audio = document.getElementById('audio-engine');
const trackListEl = document.getElementById('track-list');
const audioInput = document.getElementById('audio-input');
const directorFilter = document.getElementById('director-filter');
const searchInput = document.getElementById('search-input');
const playBtn = document.getElementById('play-btn');
const playIcon = document.getElementById('play-icon');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const progressBar = document.getElementById('progress-bar');
const progressContainer = document.getElementById('progress-container');
const currentTimeEl = document.getElementById('current-time');
const durationTimeEl = document.getElementById('duration-time');
const npTitle = document.getElementById('np-title');
const npDirector = document.getElementById('np-director');

const getTodayDate = () => new Date().toISOString().slice(0, 10);

// Initialize DB and UI
initDB().then(() => refreshLibrary());

// Upload Handler
audioInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  const defaultName = file.name.replace(/\.[^/.]+$/, '');
  const songName = prompt('Enter Song Name:', defaultName) || defaultName;
  const directorName = prompt('Enter Music Director Name:', 'UNKNOWN DIRECTOR') || 'UNKNOWN DIRECTOR';

  await saveSong(file, songName.trim(), directorName.trim());
  audioInput.value = '';
  await refreshLibrary();
});

async function refreshLibrary() {
  songs = await getAllSongs();
  populateDirectorFilter();
  renderSongs();
}

function populateDirectorFilter() {
  const currentVal = directorFilter.value;
  const directors = [...new Set(songs.map((s) => s.director))].filter(Boolean);

  directorFilter.innerHTML = '<option value="All">ALL DIRECTORS</option>';
  directors.forEach((dir) => {
    const opt = document.createElement('option');
    opt.value = dir;
    opt.textContent = dir.toUpperCase();
    directorFilter.appendChild(opt);
  });

  if (directors.includes(currentVal)) {
    directorFilter.value = currentVal;
  }
}

// Render dynamic track list matching exact UI
function renderSongs() {
  const filter = directorFilter.value;
  const search = searchInput.value.toLowerCase().trim();
  const today = getTodayDate();

  trackListEl.innerHTML = '';

  songs.forEach((song, index) => {
    if (filter !== 'All' && song.director !== filter) return;
    if (
      search &&
      !song.title.toLowerCase().includes(search) &&
      !song.director.toLowerCase().includes(search)
    ) {
      return;
    }

    const isPlayedToday = song.lastPlayedDate === today;
    const isCurrent = currentSongIndex === index;

    const div = document.createElement('div');
    div.className = `song-card ${isCurrent ? 'active' : ''} ${isPlayedToday ? 'played-today' : ''}`;
    div.innerHTML = `
      <div class="song-left-col">
        <i class="fa-solid fa-music song-note-icon"></i>
        <div class="song-meta-text">
          <div class="song-name">
            ${escapeHtml(song.title)}
            ${isPlayedToday ? '<span class="played-badge">Played Today</span>' : ''}
          </div>
          <div class="song-artist">${escapeHtml(song.director || 'UNKNOWN DIRECTOR')}</div>
        </div>
      </div>
      <div class="song-actions">
        <button class="edit-pill-btn" onclick="editSong(${song.id})">
          <i class="fa-solid fa-pen-to-square"></i> Edit
        </button>
        <button class="trash-circle-btn" onclick="removeSong(${song.id})">
          <i class="fa-solid fa-trash-can"></i>
        </button>
        <button class="card-play-btn" onclick="playIndex(${index})">
          <i class="fa-solid ${isCurrent && !audio.paused ? 'fa-pause' : 'fa-play'}"></i>
        </button>
      </div>
    `;
    trackListEl.appendChild(div);
  });
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// Playback Logic & AirPods MediaSession Integration
window.playIndex = async function (index) {
  if (index < 0 || index >= songs.length) return;

  if (currentSongIndex === index && audio.src) {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
    syncPlaybackUI();
    return;
  }

  currentSongIndex = index;
  const song = songs[currentSongIndex];

  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
  }
  currentObjectUrl = URL.createObjectURL(song.blob);
  audio.src = currentObjectUrl;

  try {
    await audio.play();
  } catch (err) {
    console.warn('Playback error:', err);
  }

  npTitle.textContent = song.title;
  npDirector.textContent = song.director || 'UNKNOWN DIRECTOR';

  // Mark as played today
  await markSongPlayedToday(song.id);
  song.lastPlayedDate = getTodayDate();

  updateAirPodsSession(song);
  syncPlaybackUI();
};

function updateAirPodsSession(song) {
  if (!('mediaSession' in navigator)) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.director || 'UNKNOWN DIRECTOR',
    album: 'Rishi Music Hub',
    artwork: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });

  navigator.mediaSession.setActionHandler('play', () => {
    audio.play();
    syncPlaybackUI();
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    audio.pause();
    syncPlaybackUI();
  });
  navigator.mediaSession.setActionHandler('previoustrack', playPrevious);
  navigator.mediaSession.setActionHandler('nexttrack', playNext);

  try {
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime && audio.duration) {
        audio.currentTime = details.seekTime;
      }
    });
  } catch (e) {}
}

function syncPlaybackUI() {
  const isPlaying = !audio.paused;
  playIcon.className = isPlaying ? 'fa-solid fa-pause' : 'fa-play';
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }
  renderSongs();
}

// Continuous Playback without repeating tracks played today
function playNext() {
  if (songs.length === 0) return;
  const today = getTodayDate();
  const filter = directorFilter.value;

  const pool = songs
    .map((s, idx) => ({ ...s, originalIndex: idx }))
    .filter((s) => (filter === 'All' || s.director === filter) && s.lastPlayedDate !== today);

  if (pool.length > 0) {
    const nextSong = filter === 'All' ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
    playIndex(nextSong.originalIndex);
  } else {
    const nextIdx = (currentSongIndex + 1) % songs.length;
    playIndex(nextIdx);
  }
}

function playPrevious() {
  if (songs.length === 0) return;
  const prevIdx = (currentSongIndex - 1 + songs.length) % songs.length;
  playIndex(prevIdx);
}

// Audio Engine Events
audio.addEventListener('ended', playNext);
audio.addEventListener('play', syncPlaybackUI);
audio.addEventListener('pause', syncPlaybackUI);

audio.addEventListener('timeupdate', () => {
  if (!audio.duration || isNaN(audio.duration)) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  progressBar.style.width = `${pct}%`;
  currentTimeEl.textContent = formatDuration(audio.currentTime);
  durationTimeEl.textContent = formatDuration(audio.duration);
});

playBtn.addEventListener('click', () => {
  if (!audio.src && songs.length > 0) {
    playIndex(0);
    return;
  }
  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
  syncPlaybackUI();
});

prevBtn.addEventListener('click', playPrevious);
nextBtn.addEventListener('click', playNext);

progressContainer.addEventListener('click', (e) => {
  if (!audio.duration) return;
  const rect = progressContainer.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  audio.currentTime = (clickX / rect.width) * audio.duration;
});

function formatDuration(sec) {
  if (isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Edit & Delete Handlers
window.editSong = async function (id) {
  const song = songs.find((s) => s.id === id);
  if (!song) return;
  const newTitle = prompt('Edit Track Name:', song.title);
  const newDirector = prompt('Edit Music Director:', song.director);
  if (newTitle && newDirector) {
    await updateSong(id, newTitle.trim(), newDirector.trim());
    await refreshLibrary();
  }
};

window.removeSong = async function (id) {
  if (confirm('Delete this song from your permanent audio storage?')) {
    if (songs[currentSongIndex] && songs[currentSongIndex].id === id) {
      audio.pause();
      audio.src = '';
      currentSongIndex = -1;
      npTitle.textContent = 'No track playing';
      npDirector.textContent = 'Select a song from your library';
      syncPlaybackUI();
    }
    await deleteSong(id);
    await refreshLibrary();
  }
};

directorFilter.addEventListener('change', renderSongs);
searchInput.addEventListener('input', renderSongs);