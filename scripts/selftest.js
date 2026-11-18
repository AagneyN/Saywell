// Runs the Electron end-to-end self-test against a throwaway profile.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import electron from 'electron';

const root = process.cwd();
const wav = join(root, 'tests', 'fixtures', 'dictation.wav');
if (!existsSync(wav) && process.platform === 'win32') {
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'make-test-audio.ps1'), '-Out', wav], { stdio: 'inherit' });
}
const shots = join(root, 'tests', 'screenshots');
const child = spawn(electron, ['.', '--selftest'], { cwd: root, stdio: 'inherit', env: { ...process.env, SAYWELL_SELFTEST_WAV: wav, SAYWELL_SHOTS: shots } });
const killer = setTimeout(() => { console.error('Self-test timed out'); child.kill(); process.exit(1); }, 15 * 60_000);
child.on('exit', (code) => { clearTimeout(killer); console.log(code === 0 ? '\nSELF-TEST PASSED' : `\nSELF-TEST FAILED (exit ${code})`); process.exit(code ?? 1); });
