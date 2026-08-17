import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * Motion layer for the marketing pages.
 *
 * Three rules this file exists to enforce:
 *   1. If the user prefers reduced motion, none of this runs.
 *   2. Nothing here gates content. `.no-motion` in the base CSS keeps every
 *      revealable element visible, and it is only removed once we know we are
 *      going to animate. A JS failure degrades to a plain, readable page.
 *   3. It initialises after first paint so it cannot delay LCP.
 */

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function init() {
  if (prefersReduced.matches) return;

  gsap.registerPlugin(ScrollTrigger);

  // --- Smooth scroll -------------------------------------------------------
  const lenis = new Lenis({
    duration: 1.05,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    // Touch devices already have good native inertia; overriding it feels worse.
    syncTouch: false,
  });

  lenis.on('scroll', ScrollTrigger.update);

  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);

  // Anchor links need to go through Lenis or they jump instantly.
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target as HTMLElement, { offset: -80 });
    });
  });

  // --- Scroll reveals ------------------------------------------------------
  // Elements opt in with `data-reveal`. Optional `data-reveal-delay` in ms.
  const revealables = gsap.utils.toArray<HTMLElement>('[data-reveal]');

  revealables.forEach((el) => {
    const delay = Number(el.dataset.revealDelay ?? 0) / 1000;

    gsap.to(el, {
      opacity: 1,
      y: 0,
      duration: 0.75,
      delay,
      ease: 'expo.out',
      scrollTrigger: {
        trigger: el,
        start: 'top 88%',
        once: true,
      },
      onComplete: () => {
        el.classList.add('is-revealed');
        // Release the compositor hint once the element has settled.
        el.style.willChange = 'auto';
      },
    });
  });

  // --- Staggered groups ----------------------------------------------------
  // A container marked `data-reveal-group` staggers its `[data-reveal-item]`
  // children, which reads better than each card firing on its own trigger.
  gsap.utils.toArray<HTMLElement>('[data-reveal-group]').forEach((group) => {
    const items = group.querySelectorAll('[data-reveal-item]');
    if (!items.length) return;

    gsap.fromTo(
      items,
      { opacity: 0, y: 24 },
      {
        opacity: 1,
        y: 0,
        duration: 0.7,
        stagger: 0.08,
        ease: 'expo.out',
        scrollTrigger: { trigger: group, start: 'top 85%', once: true },
      }
    );
  });

  // --- Hero intro ----------------------------------------------------------
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (hero) {
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });

    tl.fromTo(
      hero.querySelectorAll('[data-hero-line]'),
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 0.9, stagger: 0.09 }
    )
      .fromTo(
        hero.querySelectorAll('[data-hero-fade]'),
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.7, stagger: 0.07 },
        '-=0.5'
      )
      .fromTo(
        hero.querySelectorAll('[data-hero-rule]'),
        { scaleX: 0 },
        { scaleX: 1, duration: 1.1, transformOrigin: 'left center' },
        '-=0.8'
      );

    // Parallax drift on the hero backdrop as the page scrolls away.
    const backdrop = hero.querySelector('[data-hero-backdrop]');
    if (backdrop) {
      gsap.to(backdrop, {
        yPercent: 16,
        ease: 'none',
        scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
      });
    }
  }

  // --- Header state --------------------------------------------------------
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (header) {
    ScrollTrigger.create({
      start: 'top -80',
      onUpdate: (self) => header.classList.toggle('is-stuck', self.scroll() > 80),
    });
  }

  // Content collections and images can change layout after load.
  window.addEventListener('load', () => ScrollTrigger.refresh());
}

// Defer past first paint so the motion bundle can never delay LCP.
if (document.readyState === 'complete') {
  requestAnimationFrame(init);
} else {
  window.addEventListener('load', () => requestAnimationFrame(init), { once: true });
}

// If the user flips the OS setting mid-session, respect it on next load.
prefersReduced.addEventListener('change', (e) => {
  if (e.matches) document.documentElement.classList.add('no-motion');
});
