export const film = {
  target: 0,
  current: 0,
  wake: () => {},
};

export const BEATS = 7;

export function measure(root: HTMLElement): number {
  const box = root.getBoundingClientRect();
  const travel = box.height - window.innerHeight;
  if (travel <= 0) return 0;
  return Math.min(1, Math.max(0, -box.top / travel));
}
