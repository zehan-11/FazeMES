<template>
  <svg class="fm-success-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" opacity=".5" />
    <path
      d="m7.3 12 3.1 3.1 6.4-6.5"
      pathLength="1"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
<style scoped>
.fm-success-mark {
  width: 1.1em;
  height: 1.1em;
  flex: none;
  color: var(--fm-tone-success);
  overflow: visible;
}
path {
  stroke-dasharray: 1;
  animation: finish-check 0.32s ease-out both;
}
circle {
  transform-origin: center;
  animation: success-pulse 0.58s ease-out;
}
@keyframes finish-check {
  from {
    stroke-dashoffset: 1;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes success-pulse {
  40% {
    transform: scale(1.24);
    opacity: 0.9;
  }
}
@media (prefers-reduced-motion: reduce) {
  path,
  circle {
    animation: none;
  }
}
</style>
