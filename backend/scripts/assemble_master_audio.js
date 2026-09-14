const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AUDIO_DIR = path.join(__dirname, 'narration_audio');
const manifest = JSON.parse(fs.readFileSync(path.join(AUDIO_DIR, 'manifest.json'), 'utf8'));

// Generate silence files
const silence18 = path.join(AUDIO_DIR, 'silence_18.wav');
execSync(`"D:\\ffmpeg\\bin\\ffmpeg.exe" -f lavfi -i anullsrc=r=22050:cl=mono -t 1.8 -c:a pcm_s16le -y "${silence18}"`);

const silence35 = path.join(AUDIO_DIR, 'silence_35.wav');
execSync(`"D:\\ffmpeg\\bin\\ffmpeg.exe" -f lavfi -i anullsrc=r=22050:cl=mono -t 3.5 -c:a pcm_s16le -y "${silence35}"`);

// Build concat list for ffmpeg
const fileList = [];
manifest.forEach(m => {
  fileList.push(`file '${silence18.replace(/\\/g, '/')}'`);
  fileList.push(`file '${m.audioFile.replace(/\\/g, '/')}'`);
});
fileList.push(`file '${silence35.replace(/\\/g, '/')}'`);

const listTxt = path.join(AUDIO_DIR, 'concat_list.txt');
fs.writeFileSync(listTxt, fileList.join('\n'), 'utf8');

const masterWav = path.join(AUDIO_DIR, 'master_narration.wav');
execSync(`"D:\\ffmpeg\\bin\\ffmpeg.exe" -f concat -safe 0 -i "${listTxt}" -c:a pcm_s16le -y "${masterWav}"`);

console.log('✅ Master WAV generated at:', masterWav);
let probe = '';
try {
  execSync(`"D:\\ffmpeg\\bin\\ffmpeg.exe" -i "${masterWav}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
} catch (err) {
  probe = (err.stderr ? err.stderr.toString() : '') + (err.stdout ? err.stdout.toString() : '');
}
const match = probe.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
if (match) {
  const dur = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
  console.log(`⏱️ Total Master Audio Duration: ${dur} seconds (~${(dur / 60).toFixed(2)} minutes)`);
}
