/** Equal-tempered tuning with A4 = 440 Hz. */
export const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
export const noteName = midi => ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][midi % 12] + (Math.floor(midi / 12) - 1);
