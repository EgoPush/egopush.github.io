(() => {
  const states = new Map();
  let suspended = false;
  let scheduled = false;

  const revealPoster = (video) => {
    if (video.dataset.poster && !video.poster) video.poster = video.dataset.poster;
  };
  const load = (video, state) => {
    if (state.loaded) return;
    revealPoster(video);
    video.querySelectorAll('source[data-src]').forEach(source => {
      source.src = source.dataset.src;
    });
    state.loaded = true;
    video.load();
  };
  const unload = (video, state) => {
    if (!state.loaded || state.wanted) return;
    state.time = video.currentTime || state.time;
    video.querySelectorAll('source[data-src]').forEach(source => source.removeAttribute('src'));
    video.removeAttribute('src');
    state.loaded = false;
    video.load(); // Abort off-screen downloads as well as decoding.
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; reconcile(); });
  };
  const reconcile = () => {
    const candidates = [...states].filter(([video, state]) =>
      video.isConnected && state.ratio >= 0.15 && !state.userPaused && !state.failed &&
      (state.manual || performance.now() - state.visibleSince >= 250)
    );
    const selected = new Set((document.hidden || suspended ? [] : candidates)
      .map(([video]) => video));
    states.forEach((state, video) => {
      const wanted = selected.has(video);
      state.wanted = wanted;
      if (wanted) {
        clearTimeout(state.releaseTimer);
        state.releaseTimer = null;
        load(video, state);
        if (video.paused && !state.pending) {
          state.pending = true;
          if (state.button) state.button.hidden = true;
          video.play().catch(error => {
            if (error.name !== 'AbortError' && state.wanted) {
              state.failed = true;
              state.wanted = false;
              if (state.button) state.button.hidden = false;
            }
          }).finally(() => { state.pending = false; });
        }
      } else {
        video.pause();
        if (state.button) state.button.hidden = !state.failed;
        if (document.hidden || suspended) {
          clearTimeout(state.releaseTimer);
          state.releaseTimer = null;
          unload(video, state);
        } else if (state.loaded && !state.releaseTimer && (!state.userPaused || state.ratio < 0.15)) {
          state.releaseTimer = setTimeout(() => {
            state.releaseTimer = null;
            unload(video, state);
          }, 1500);
        }
      }
    });
  };
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(({ target, intersectionRatio }) => {
      const state = states.get(target);
      if (state) {
        if (intersectionRatio >= 0.15 && state.ratio < 0.15) {
          state.visibleSince = performance.now();
          state.userPaused = state.failed = false;
          clearTimeout(state.enterTimer);
          state.enterTimer = setTimeout(schedule, 270);
        }
        state.ratio = intersectionRatio;
      }
    });
    schedule();
  }, { threshold: [0, 0.15, 0.35, 0.6, 1] }) : null;
  const posterObserver = observer ? new IntersectionObserver(entries => {
    entries.forEach(({ target, isIntersecting }) => {
      if (isIntersecting) revealPoster(target);
    });
  }, { rootMargin: '250px' }) : null;

  const register = () => {
    states.forEach((state, video) => {
      if (video.isConnected) return;
      state.wanted = false;
      video.pause();
      clearTimeout(state.releaseTimer);
      clearTimeout(state.enterTimer);
      unload(video, state);
      observer?.unobserve(video);
      posterObserver?.unobserve(video);
      states.delete(video);
    });
    document.querySelectorAll('video[data-managed]').forEach(video => {
      if (states.has(video)) return;
      const state = { ratio: 0, loaded: false, wanted: false, manual: false,
        userPaused: false, failed: false, pending: false, time: 0, visibleSince: 0 };
      states.set(video, state);
      video.muted = true;
      if (!video.classList.contains('project-hero-video')) {
        const wrapper = document.createElement('div');
        wrapper.className = 'media-player';
        video.before(wrapper);
        wrapper.append(video);
        const button = document.createElement('button');
        button.className = 'media-play-button';
        button.type = 'button';
        button.hidden = true;
        button.textContent = '▶ Play';
        button.setAttribute('aria-label', `Play ${video.getAttribute('aria-label') || 'video'}`);
        button.addEventListener('click', () => {
          state.manual = true;
          state.userPaused = state.failed = false;
          if (!observer) state.ratio = 1;
          // Run inside the click handler to retain browser playback permission.
          reconcile();
        });
        wrapper.append(button);
        state.button = button;
      }
      video.addEventListener('loadedmetadata', () => {
        if (state.time > 0 && state.time < video.duration) video.currentTime = state.time;
      });
      video.addEventListener('play', () => {
        if (!state.wanted) {
          state.manual = true;
          state.userPaused = state.failed = false;
          schedule();
        }
        if (state.button) state.button.hidden = true;
      });
      video.addEventListener('pause', () => {
        if (state.wanted) {
          state.userPaused = true;
          state.wanted = false;
          if (state.button) state.button.hidden = false;
          schedule();
        }
      });
      observer?.observe(video);
      posterObserver?.observe(video);
      if (!observer) revealPoster(video);
    });
    schedule();
  };
  window.reviewMedia = { setSuspended(value) { suspended = value; reconcile(); } };
  register();
  new MutationObserver(register).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', () => {
    // Background tabs throttle animation frames; pause synchronously.
    if (document.hidden) reconcile();
    else schedule();
  });

})();
