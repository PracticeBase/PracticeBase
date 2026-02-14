import {
  auth,
  db,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  collection,
  query,
  orderBy,
  limit,
  getDocs
} from "../firebase.js";

/* ---------------------------
   DOM HELPERS
---------------------------- */
const $ = id => document.getElementById(id);
const status = msg => { const el = $("status"); if (el) el.textContent = msg; };

/* ---------------------------
   SCREENS
---------------------------- */
const screens = {
  bioAutoScreen: $("bioAutoScreen"),
  loginScreen: $("loginScreen"),
  setupScreen: $("setupScreen"),
  homeScreen: $("homeScreen"),
  scheduleScreen: $("scheduleScreen"),
  mediaScreen: $("mediaScreen"),
  profileScreen: $("profileScreen")
};

let currentScreen = "loginScreen";

/* ---------------------------
   LOCAL STORAGE KEYS & STATE
---------------------------- */
const DEVICE_KEY = "pb_bio_key";
const THEME_KEY = "pb_theme";
const PRACTICE_TODAY_KEY = "pb_practice_today";
const PRACTICE_DATE_KEY = "pb_practice_date";
const PRACTICE_GOAL_KEY = "pb_practice_goal";
const STREAK_KEY = "pb_streak_days";
const NOTIF_ENABLED_KEY = "pb_notif_enabled";

let practiceTimer = null;
let reminderTimer = null;
let deferredPrompt = null;

/* ---------------------------
   UTILITIES
---------------------------- */
function isMobile() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
}
function hasBiometric() {
  return !!localStorage.getItem(DEVICE_KEY);
}
function saveBiometric(id) {
  localStorage.setItem(DEVICE_KEY, id);
}

/* ---------------------------
   SCREEN SHOW / HIDE + NAV
---------------------------- */
function show(screenName) {
  currentScreen = screenName;

  Object.entries(screens).forEach(([name, el]) => {
    if (!el) return;
    if (name === screenName) {
      el.classList.remove("hidden");
      requestAnimationFrame(() => el.classList.add("active"));
    } else {
      el.classList.remove("active");
      setTimeout(() => el.classList.add("hidden"), 300);
    }
  });

  const hideNavScreens = ["loginScreen", "setupScreen", "bioAutoScreen"];
  const bottomNav = $("bottomNav");
  if (bottomNav) {
    if (hideNavScreens.includes(screenName)) bottomNav.classList.add("hidden");
    else bottomNav.classList.remove("hidden");
  }

  maybeShowInstallModal();
}

/* ---------------------------
   THEME
---------------------------- */
function applyTheme(theme) {
  if (theme === "dark") document.body.classList.add("dark");
  else document.body.classList.remove("dark");
}
function toggleTheme() {
  const current = localStorage.getItem(THEME_KEY) || "light";
  const next = current === "light" ? "dark" : "light";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}
applyTheme(localStorage.getItem(THEME_KEY) || "light");
$("themeToggle")?.addEventListener("click", toggleTheme);

/* ---------------------------
   AUTH / LOGIN
---------------------------- */
$("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  status("Logging in…");
  try {
    const email = $("email").value;
    const password = $("password").value;
    await signInWithEmailAndPassword(auth, email, password);

    if (!hasBiometric()) {
      show("setupScreen");
    } else {
      await loadHome();
      show("homeScreen");
      setActiveNav(0);
    }
    status("Logged in.");
  } catch (err) {
    status(err.message || "Login failed.");
  }
});

/* Biometric login button (manual) */
$("bioLoginBtn")?.addEventListener("click", async () => {
  status("Authenticating…");
  try {
    const id = localStorage.getItem(DEVICE_KEY);
    if (!id) return status("No biometric key found.");
    await navigator.credentials.get({
      publicKey: {
        challenge: new Uint8Array(32),
        allowCredentials: [{ id: Uint8Array.from(atob(id), c => c.charCodeAt(0)), type: "public-key" }],
        userVerification: "required"
      }
    });
    await loadHome();
    show("homeScreen");
    setActiveNav(0);
    status("Biometric login successful.");
  } catch (err) {
    status("Biometric login failed.");
  }
});

/* ---------------------------
   BIOMETRIC SETUP SCREEN
---------------------------- */
$("enableBioBtn")?.addEventListener("click", async () => {
  status("Setting up biometrics…");
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: new Uint8Array(32),
        rp: { name: "PracticeBase" },
        user: {
          id: new Uint8Array(16),
          name: auth.currentUser?.email || "user",
          displayName: auth.currentUser?.email || "user"
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" }
      }
    });

    const id = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
    saveBiometric(id);

    await loadHome();
    show("homeScreen");
    setActiveNav(0);
    status("Biometrics enabled.");
  } catch (err) {
    status("Biometric setup failed.");
  }
});

$("skipBioBtn")?.addEventListener("click", async () => {
  await loadHome();
  show("homeScreen");
  setActiveNav(0);
});

/* ---------------------------
   AUTO BIOMETRIC SCREEN (on open)
---------------------------- */
function shouldAutoBiometric() {
  return hasBiometric() && isMobile() && !isStandalone();
}

async function triggerAutoBiometric() {
  const id = localStorage.getItem(DEVICE_KEY);
  if (!id) return show("loginScreen");

  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: new Uint8Array(32),
        allowCredentials: [{ id: Uint8Array.from(atob(id), c => c.charCodeAt(0)), type: "public-key" }],
        userVerification: "required"
      }
    });

    await loadHome();
    show("homeScreen");
    setActiveNav(0);
    status("Logged in with biometrics.");
  } catch (err) {
    show("loginScreen");
  }
}

$("bioAutoBtn")?.addEventListener("click", triggerAutoBiometric);
$("bioAutoSkip")?.addEventListener("click", () => show("loginScreen"));

/* ---------------------------
   HOME / DASHBOARD DATA
---------------------------- */
async function loadHome() {
  if (!auth.currentUser) return;

  $("welcomeText").textContent = auth.currentUser.email || "";
  $("profileEmail").textContent = auth.currentUser.email || "";

  // Latest announcement
  try {
    const annQ = query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(1));
    const annSnap = await getDocs(annQ);
    $("latestAnnouncement").textContent = annSnap.empty ? "No announcements yet." : annSnap.docs[0].data().message;
  } catch {
    $("latestAnnouncement").textContent = "No announcements yet.";
  }

  // Next rehearsal
  try {
    const schQ = query(collection(db, "schedule"), orderBy("sortTimestamp", "asc"), limit(1));
    const schSnap = await getDocs(schQ);
    if (schSnap.empty) {
      $("nextRehearsal").textContent = "No rehearsals scheduled.";
      $("nextRehearsalTime").textContent = "";
      updateCountdown(null);
    } else {
      const s = schSnap.docs[0].data();
      $("nextRehearsal").textContent = s.title || "Rehearsal";
      $("nextRehearsalTime").textContent = `${s.date || ""} ${s.time || ""}`;
      updateCountdown(s.date || s.datetime || s.isoDate || null);
    }
  } catch {
    $("nextRehearsal").textContent = "No rehearsals scheduled.";
    updateCountdown(null);
  }

  // Practice goal input
  const goal = parseInt(localStorage.getItem(PRACTICE_GOAL_KEY) || "60", 10);
  if ($("practiceGoalInput")) $("practiceGoalInput").value = goal;

  updatePracticeProgress();
  updateStreakDisplay();
}

/* ---------------------------
   COUNTDOWN (fixed parsing)
---------------------------- */
function updateCountdown(dateStr) {
  const ring = $("countdownRing");
  const text = $("countdownText");

  if (!dateStr) {
    if (ring) ring.style.background = "conic-gradient(var(--accent) 0deg, rgba(0,0,0,0.08) 0deg)";
    if (text) text.textContent = "--";
    return;
  }

  // Try to parse common formats robustly
  let target = null;
  // If already ISO-like, use directly
  try {
    target = new Date(dateStr);
    if (isNaN(target.getTime())) {
      // Replace dashes with slashes to help Safari/older engines
      target = new Date(dateStr.replace(/-/g, "/"));
    }
  } catch {
    target = new Date(dateStr.replace(/-/g, "/"));
  }

  if (!target || isNaN(target.getTime())) {
    if (text) text.textContent = "--";
    return;
  }

  const now = new Date();
  const diff = target.getTime() - now.getTime();
  const days = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));

  const maxDays = 30;
  const pct = Math.min(1, days / maxDays);
  const angle = 360 - pct * 360;

  if (ring) ring.style.background = `conic-gradient(var(--accent) 0deg, var(--accent) ${angle}deg, rgba(0,0,0,0.08) ${angle}deg)`;
  if (text) text.textContent = String(days);
}

/* ---------------------------
   PRACTICE TRACKING & PROGRESS RING
---------------------------- */
function ensureTodayReset() {
  const today = new Date().toDateString();
  const storedDate = localStorage.getItem(PRACTICE_DATE_KEY);
  if (storedDate !== today) {
    localStorage.setItem(PRACTICE_DATE_KEY, today);
    localStorage.setItem(PRACTICE_TODAY_KEY, "0");
  }
}

function updatePracticeProgress() {
  ensureTodayReset();
  const ring = $("progressRing");
  const text = $("progressText");

  const goal = parseInt(localStorage.getItem(PRACTICE_GOAL_KEY) || "60", 10);
  const minutes = parseInt(localStorage.getItem(PRACTICE_TODAY_KEY) || "0", 10);

  const pct = Math.min(1, minutes / Math.max(1, goal));
  const angle = pct * 360;

  if (ring) ring.style.background = `conic-gradient(#4caf50 0deg, #4caf50 ${angle}deg, rgba(0,0,0,0.08) ${angle}deg)`;
  if (text) text.textContent = `${minutes}/${goal} min`;

  updateStreak(minutes, goal);
}

/* Background timer that increments practice minutes every minute */
function startPracticeTimer() {
  if (practiceTimer) return;
  // Ensure today's counters are correct
  ensureTodayReset();

  practiceTimer = setInterval(() => {
    const today = new Date().toDateString();
    const storedDate = localStorage.getItem(PRACTICE_DATE_KEY);
    if (storedDate !== today) {
      localStorage.setItem(PRACTICE_DATE_KEY, today);
      localStorage.setItem(PRACTICE_TODAY_KEY, "0");
    }

    let minutes = parseInt(localStorage.getItem(PRACTICE_TODAY_KEY) || "0", 10);
    minutes += 1;
    localStorage.setItem(PRACTICE_TODAY_KEY, String(minutes));
    updatePracticeProgress();
  }, 60 * 1000); // every minute
}

/* ---------------------------
   WEEKLY STREAK
---------------------------- */
function getStreakArray() {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveStreakArray(arr) {
  localStorage.setItem(STREAK_KEY, JSON.stringify(arr));
}

/* Called whenever progress updates to add today's date if goal met */
function updateStreak(minutesToday, goal) {
  const today = new Date().toDateString();
  let streakDays = getStreakArray();

  if (minutesToday >= goal) {
    if (!streakDays.includes(today)) streakDays.push(today);
  } else {
    // If today's not meeting goal, do not remove it immediately; streak is computed from stored days
  }

  // Keep only last 30 days to avoid growth
  if (streakDays.length > 30) streakDays = streakDays.slice(-30);
  saveStreakArray(streakDays);
  updateStreakDisplay();
}

function updateStreakDisplay() {
  const streakDays = getStreakArray();
  let streak = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toDateString();
    if (streakDays.includes(ds)) streak++;
    else {
      // break on first missing day in the consecutive sequence
      if (i === 0) continue; // allow today to be missing if not yet met
      break;
    }
  }
  $("streakText").textContent = `${streak} day${streak === 1 ? "" : "s"}`;
}

/* ---------------------------
   SCHEDULE & MEDIA
---------------------------- */
async function loadSchedule() {
  const box = $("scheduleList");
  if (!box) return;
  box.textContent = "Loading…";

  try {
    const qSch = query(collection(db, "schedule"), orderBy("sortTimestamp", "asc"), limit(50));
    const snap = await getDocs(qSch);
    if (snap.empty) {
      box.textContent = "No schedule yet.";
      return;
    }
    box.innerHTML = "";
    snap.forEach(d => {
      const s = d.data();
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        <strong>${s.title || "Rehearsal"}</strong><br>
        <span>${s.date || ""} ${s.time || ""}</span><br>
        <span class="muted small">${s.who || ""}</span>
      `;
      box.appendChild(div);
    });
  } catch {
    box.textContent = "Unable to load schedule.";
  }
}

async function loadMedia() {
  const box = $("mediaList");
  if (!box) return;
  box.textContent = "Loading…";

  try {
    const tracksQ = query(collection(db, "tracks"), orderBy("createdAt", "desc"), limit(20));
    const videosQ = query(collection(db, "videos"), orderBy("createdAt", "desc"), limit(20));
    const [tracksSnap, videosSnap] = await Promise.all([getDocs(tracksQ), getDocs(videosQ)]);

    box.innerHTML = "";
    if (!tracksSnap.empty) {
      const h = document.createElement("h3"); h.textContent = "Tracks"; box.appendChild(h);
      tracksSnap.forEach(d => {
        const t = d.data();
        const div = document.createElement("div");
        div.className = "list-item";
        div.innerHTML = `<strong>${t.title || "Track"}</strong><br><span class="muted small">${t.url}</span>`;
        const btn = document.createElement("button");
        btn.className = "media-btn";
        btn.textContent = "Open Track";
        btn.onclick = () => window.open(t.url, "_blank");
        div.appendChild(btn);
        box.appendChild(div);
      });
    }

    if (!videosSnap.empty) {
      const h = document.createElement("h3"); h.textContent = "Videos"; box.appendChild(h);
      videosSnap.forEach(d => {
        const v = d.data();
        const div = document.createElement("div");
        div.className = "list-item";
        div.innerHTML = `<strong>${v.title || "Video"}</strong><br><span class="muted small">${v.url}</span>`;
        const btn = document.createElement("button");
        btn.className = "media-btn";
        btn.textContent = "Open Video";
        btn.onclick = () => window.open(v.url, "_blank");
        div.appendChild(btn);
        box.appendChild(div);
      });
    }

    if (tracksSnap.empty && videosSnap.empty) box.textContent = "No media yet.";
  } catch {
    box.textContent = "Unable to load media.";
  }
}

/* ---------------------------
   BOTTOM NAV + SWIPE
---------------------------- */
function setActiveNav(index) {
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.classList.remove("active");
    if (parseInt(btn.dataset.index, 10) === index) btn.classList.add("active");
  });
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.target;
    const index = parseInt(btn.dataset.index, 10);
    setActiveNav(index);

    if (target === "scheduleScreen") loadSchedule();
    if (target === "mediaScreen") loadMedia();
    if (target === "homeScreen") loadHome();

    show(target);
  });
});

let touchStartX = 0;
let touchEndX = 0;
function handleGesture() {
  const delta = touchEndX - touchStartX;
  if (Math.abs(delta) < 50) return;
  const navButtons = Array.from(document.querySelectorAll(".nav-btn"));
  const currentIndex = navButtons.findIndex(b => b.classList.contains("active"));
  if (currentIndex === -1) return;
  let nextIndex = currentIndex;
  if (delta < 0 && currentIndex < navButtons.length - 1) nextIndex++;
  if (delta > 0 && currentIndex > 0) nextIndex--;
  if (nextIndex !== currentIndex) navButtons[nextIndex].click();
}
document.addEventListener("touchstart", e => { touchStartX = e.changedTouches[0].screenX; });
document.addEventListener("touchend", e => { touchEndX = e.changedTouches[0].screenX; handleGesture(); });

/* ---------------------------
   PRACTICE GOAL SETTINGS
---------------------------- */
$("savePracticeGoal")?.addEventListener("click", () => {
  const goal = parseInt($("practiceGoalInput").value, 10);
  if (goal > 0) {
    localStorage.setItem(PRACTICE_GOAL_KEY, String(goal));
    updatePracticeProgress();
    status("Practice goal updated.");
  } else {
    status("Enter a valid goal.");
  }
});

/* ---------------------------
   NOTIFICATIONS / REMINDERS
---------------------------- */
$("enableNotifications")?.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    status("Notifications not supported.");
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === "granted") {
    localStorage.setItem(NOTIF_ENABLED_KEY, "1");
    startReminderTimer();
    status("Notifications enabled.");
  } else {
    status("Notifications denied.");
  }
});

function startReminderTimer() {
  if (reminderTimer) return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  // Send a reminder every hour until goal met
  reminderTimer = setInterval(() => {
    const goal = parseInt(localStorage.getItem(PRACTICE_GOAL_KEY) || "60", 10);
    const minutes = parseInt(localStorage.getItem(PRACTICE_TODAY_KEY) || "0", 10);
    if (minutes < goal) {
      new Notification("Time to practice!", {
        body: "You haven't hit your practice goal yet today.",
        tag: "practice-reminder"
      });
    }
  }, 60 * 60 * 1000);
}

/* ---------------------------
   INSTALL PROMPT (FULLSCREEN ON MOBILE UNTIL INSTALLED)
---------------------------- */
function maybeShowInstallModal() {
  const modal = $("installModal");
  if (!modal) return;
  if (!isMobile()) { modal.classList.remove("active"); return; }
  if (isStandalone()) { modal.classList.remove("active"); return; }
  if (!deferredPrompt) { modal.classList.remove("active"); return; }
  // Show only on login/setup/bioAuto screens
  if (["loginScreen", "setupScreen", "bioAutoScreen"].includes(currentScreen)) modal.classList.add("active");
  else modal.classList.remove("active");
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  maybeShowInstallModal();
});

$("installModalBtn")?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  $("installModal")?.classList.remove("active");
  deferredPrompt = null;
});

$("installModalSkip")?.addEventListener("click", () => {
  $("installModal")?.classList.remove("active");
});

/* When installed, hide modal */
window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  $("installModal")?.classList.remove("active");
});

/* ---------------------------
   SIGN OUT
---------------------------- */
$("logoutBtn")?.addEventListener("click", async () => {
  await signOut(auth);
  show("loginScreen");
  setActiveNav(0);
  status("Signed out.");
});

/* ---------------------------
   AUTH STATE HANDLING
---------------------------- */
onAuthStateChanged(auth, (user) => {
  if (user) {
    if (hasBiometric()) $("bioLoginBtn")?.classList.remove("hidden");
    startPracticeTimer();
    if (localStorage.getItem(NOTIF_ENABLED_KEY) === "1") startReminderTimer();
    // After sign-in, show login screen briefly or go to home depending on flow
    show("loginScreen");
  } else {
    // Not signed in: if biometrics available and mobile, show auto biometric screen
    // Splash logic will handle initial display; this ensures subsequent opens behave
    if (shouldAutoBiometric()) {
      show("bioAutoScreen");
      // triggerAutoBiometric will be called after splash timeout if present
    } else {
      show("loginScreen");
    }
  }
});

/* ---------------------------
   SPLASH -> INITIAL FLOW
---------------------------- */
setTimeout(() => {
  $("splashScreen")?.style.display = "none";

  // If biometrics available and mobile, show auto biometric screen
  if (shouldAutoBiometric()) {
    show("bioAutoScreen");
    // Attempt auto biometric immediately (but allow user to tap)
    triggerAutoBiometric().catch(() => {
      // fallback to login screen if it fails
      show("loginScreen");
    });
  } else {
    show("loginScreen");
  }
}, 1400);

/* ---------------------------
   START TIMERS WHEN APP RUNS (if already signed in)
---------------------------- */
if (auth.currentUser) {
  startPracticeTimer();
  if (localStorage.getItem(NOTIF_ENABLED_KEY) === "1") startReminderTimer();
}

/* ---------------------------
   INITIAL UI TWEAKS
---------------------------- */
// Ensure home and other screens have safe bottom padding so content isn't hidden by nav
document.querySelectorAll(".screen").forEach(s => {
  s.style.paddingBottom = `calc(120px + env(safe-area-inset-bottom))`;
});
