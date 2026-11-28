<!--
  From Uiverse.io by JkHuger - https://uiverse.io/JkHuger/fat-bat-0
  MIT License, Copyright (c) JHEY - https://codepen.io/jh3y/pen/LYJMPBL, Jhey - https://codepen.io/jh3y/pen/LYJMPBL
-->
<script setup lang="ts">
import GlassLens from './GlassLens.vue'

// Stable positions keep the same constellation when the form re-renders.
const particles = [
  [5, 30, 5],
  [12, 12, 4],
  [23, 16, 7],
  [39, 7, 4],
  [57, 14, 6],
  [72, 4, 4],
  [88, 12, 6],
  [95, 66, 4],
  [81, 80, 5],
  [68, 87, 7],
  [51, 82, 4],
  [37, 89, 5],
  [19, 78, 6],
  [7, 72, 4]
]
</script>

<template>
  <GlassLens />
  <span aria-hidden="true" class="login-sparkles">
    <span class="sparkle-dust">
      <svg
        v-for="([x, y, size], i) in particles"
        :key="i"
        viewBox="0 0 15 15"
        focusable="false"
        :style="{
          left: x + '%',
          top: y + '%',
          width: size + 'px',
          animationDelay: -i * 0.37 + 's',
          animationDuration: 2.4 + (i % 4) * 0.45 + 's'
        }"
      >
        <path
          d="M6.937 3.846L7.75 1L8.563 3.846C8.77313 4.58114 9.1671 5.25062 9.70774 5.79126C10.2484 6.3319 10.9179 6.72587 11.653 6.936L14.5 7.75L11.654 8.563C10.9189 8.77313 10.2494 9.1671 9.70874 9.70774C9.1681 10.2484 8.77413 10.9179 8.564 11.653L7.75 14.5L6.937 11.654C6.72687 10.9189 6.3329 10.2494 5.79226 9.70874C5.25162 9.1681 4.58214 8.77413 3.847 8.564L1 7.75L3.846 6.937C4.58114 6.72687 5.25062 6.3329 5.79126 5.79226C6.3319 5.25162 6.72587 4.58214 6.936 3.847L6.937 3.846Z"
        />
      </svg>
    </span>
    <span class="sparkle-rim"></span>
    <svg class="sparkle-mark" viewBox="0 0 24 24" focusable="false">
      <path
        d="M14.187 8.096L15 5.25L15.813 8.096C16.0231 8.83114 16.4171 9.50062 16.9577 10.0413C17.4984 10.5819 18.1679 10.9759 18.903 11.186L21.75 12L18.904 12.813C18.1689 13.0231 17.4994 13.4171 16.9587 13.9577C16.4181 14.4984 16.0241 15.1679 15.814 15.903L15 18.75L14.187 15.904C13.9769 15.1689 13.5829 14.4994 13.0423 13.9587C12.5016 13.4181 11.8321 13.0241 11.097 12.814L8.25 12L11.096 11.187C11.8311 10.9769 12.5006 10.5829 13.0413 10.0423C13.5819 9.50162 13.9759 8.83214 14.186 8.097L14.187 8.096Z"
      />
      <path
        d="M6 14.25L5.741 15.285C5.59267 15.8785 5.28579 16.4206 4.85319 16.8532C4.42059 17.2858 3.87853 17.5927 3.285 17.741L2.25 18L3.285 18.259C3.87853 18.4073 4.42059 18.7142 4.85319 19.1468C5.28579 19.5794 5.59267 20.1215 5.741 20.715L6 21.75L6.259 20.715C6.40725 20.1216 6.71398 19.5796 7.14639 19.147C7.5788 18.7144 8.12065 18.4075 8.714 18.259L9.75 18L8.714 17.741C8.12065 17.5925 7.5788 17.2856 7.14639 16.853C6.71398 16.4204 6.40725 15.8784 6.259 15.285L6 14.25Z"
      />
      <path
        d="M6.5 4L6.303 4.5915C6.24777 4.75718 6.15472 4.90774 6.03123 5.03123C5.90774 5.15472 5.75718 5.24777 5.5915 5.303L5 5.5L5.5915 5.697C5.75718 5.75223 5.90774 5.84528 6.03123 5.96877C6.15472 6.09226 6.24777 6.24282 6.303 6.4085L6.5 7L6.697 6.4085C6.75223 6.24282 6.84528 6.09226 6.96877 5.96877C7.09226 5.84528 7.24282 5.75223 7.4085 5.697L8 5.5L7.4085 5.303C7.24282 5.24777 7.09226 5.15472 6.96877 5.03123C6.84528 4.90774 6.75223 4.75718 6.697 4.5915L6.5 4Z"
      />
    </svg>
  </span>
</template>

<style lang="scss">
@mixin illuminate-login-button {
  --login-spark-on: 1;
  --login-spark-play: running;
  --login-spark-bounce: fm-login-star-bounce;
  --login-spark-scale: 1.035;

  z-index: 2;
  color: #fff;

  :is(.portal-icon, .portal-arrow) {
    color: inherit;
  }
}

@media (forced-colors: none) {
  .mes-login .workspace-auth .glass-control:not(:disabled):is(:focus-visible, :active) {
    @include illuminate-login-button;
  }
}

@media (hover: hover) and (forced-colors: none) {
  .mes-login .workspace-auth .glass-control:not(:disabled):hover {
    @include illuminate-login-button;
  }
}

@media (prefers-reduced-motion: no-preference) and (forced-colors: none) {
  .mes-login .workspace-auth .glass-control {
    scale: var(--login-spark-scale, 1);
    transition:
      scale 0.3s,
      color 0.18s,
      background-color 0.18s,
      border-color 0.18s,
      box-shadow 0.18s;
  }

  .mes-login .workspace-auth .glass-control:active {
    scale: 1;
  }
}

.login-sparkles {
  --login-spark-base: color-mix(in srgb, var(--fm-menu-tint), var(--action));
  --login-spark-crest: color-mix(in srgb, var(--login-spark-base) 66%, var(--fm-glow-edge));

  position: absolute;
  z-index: 0;
  inset: -1px;
  pointer-events: none;
  border-radius: inherit;

  &::before {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 40% 55% at 50% 105%, var(--login-spark-crest), transparent),
      radial-gradient(ellipse 80% 100% at 50% 120%, var(--action), transparent),
      var(--login-spark-base);
    border: 1px solid color-mix(in srgb, var(--fm-glow-edge) 70%, var(--glass-ring));
    border-radius: inherit;
    content: '';
    opacity: var(--login-spark-on, 0);
    box-shadow: 0 0 1.5em 0.12em color-mix(in srgb, var(--fm-glow-edge) 42%, transparent);
    transition: opacity 0.3s;
  }

  .sparkle-rim {
    position: absolute;
    inset: 0;
    padding: 1.5px;
    overflow: hidden;
    border-radius: inherit;
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask-composite: exclude;

    &::before {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 210%;
      aspect-ratio: 1;
      background: conic-gradient(
        transparent 315deg,
        var(--fm-glow-edge) 348deg,
        var(--fm-rim-core)
      );
      content: '';
      opacity: calc(0.4 + var(--login-spark-on, 0) * 0.6);
      translate: -50% -50%;
      animation: fm-login-spark-orbit 3s linear infinite;
    }
  }

  .sparkle-mark {
    position: absolute;
    top: var(--login-star-top, -0.2em);
    right: var(--login-star-right, 0.4em);
    width: var(--login-star-size, 1.25em);
    fill: var(--fm-rim-core);
    opacity: var(--login-spark-on, 0);
    transition: opacity 0.2s;

    path {
      transform-box: fill-box;
      transform-origin: center;
      animation: var(--login-spark-bounce, none) 0.6s var(--star-delay, 0.1s) ease;
    }

    path:nth-child(2) {
      --star-scale: 1.5;
      --star-delay: 0.2s;
    }

    path:nth-child(3) {
      --star-scale: 2.5;
      --star-delay: 0.35s;
    }
  }

  .sparkle-dust {
    position: absolute;
    z-index: -1;
    inset: -0.9em -0.4em;
    opacity: var(--login-spark-on, 0);
    transition: opacity 0.3s;

    svg {
      position: absolute;
      fill: var(--fm-glow-edge);
      transform-origin: 140% 165%;
      animation: fm-login-spark-orbit 3s linear infinite;
      animation-play-state: var(--login-spark-play, paused);
    }

    svg:nth-child(even) {
      animation-direction: reverse;
    }
  }
}

.mes-login :is(.submit, .portal) .login-sparkles {
  --login-star-right: 3em;
  --login-star-top: calc(50% - 0.7em);
  --login-star-size: 1.4em;
}

.mes-login :is(.reveal, .extra-actions button) .login-sparkles {
  --login-star-size: 0.85em;
  --login-star-right: -0.15em;
}

@keyframes fm-login-spark-orbit {
  to {
    rotate: 1turn;
  }
}

@keyframes fm-login-star-bounce {
  35%,
  65% {
    scale: var(--star-scale, 0.5);
  }
}

.mes-login .glass-control:disabled .login-sparkles,
.mes-login .login-content[inert] .login-sparkles {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .login-sparkles::before {
    transition: none;
  }

  .login-sparkles :is(.sparkle-rim, .sparkle-mark, .sparkle-dust) {
    display: none;
  }
}

@media (forced-colors: active) {
  .login-sparkles {
    display: none;
  }
}
</style>
