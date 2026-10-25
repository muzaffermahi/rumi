// Release: writes the Homebrew formula (release/rumi.rb) and Scoop manifest (release/rumi.json) for a version,
// from the downloads and checksums in release/. `node scripts/manifests.mjs 0.5.0`
import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+/.test(version || '')) throw Error('Usage: node scripts/manifests.mjs <version>');
const release = path.resolve('release');
const url = file => `https://github.com/muzaffermahi/rumi/releases/download/v${version}/${file}`;
const sha = file => {
  const f = path.join(release, `${file}.sha256`);
  if (!fs.existsSync(f)) throw Error(`Missing ${file}.sha256 in release/`);
  return fs.readFileSync(f, 'utf8').split(/\s+/)[0];
};
const has = file => fs.existsSync(path.join(release, `${file}.sha256`));

// Homebrew: the packaged build carries its own Node, so the formula only unpacks it and links `rumi`.
const brew = [
  ['mac-arm64', 'Rumi-mac-arm64.zip'],
  ['mac-x64', 'Rumi-mac-x64.zip'],
  ['linux-x64', 'Rumi-linux-x64.tar.gz'],
].filter(([, f]) => has(f));
const conds = {'mac-arm64': 'on_macos do\n    on_arm', 'mac-x64': 'on_macos do\n    on_intel', 'linux-x64': 'on_linux do\n    on_intel'};
const rb = `class Rumi < Formula
  desc "Quiet place to write, with agents working beside your words"
  homepage "https://github.com/muzaffermahi/rumi"
  version "${version}"
  license "MIT"

${brew.map(([k, f]) => `  ${conds[k]} do\n      url "${url(f)}"\n      sha256 "${sha(f)}"\n    end\n  end`).join('\n')}

  def install
    libexec.install Dir["*"]
    (bin/"rumi").write <<~SH
      #!/bin/sh
      exec "#{libexec}/node/bin/node" "#{libexec}/app/bin/rumi.mjs" "$@"
    SH
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/rumi --version")
  end
end
`;
fs.writeFileSync(path.join(release, 'rumi.rb'), rb);

// Scoop (Windows).
const win = 'Rumi-windows-x64.zip';
if (has(win)) {
  const scoop = {
    version,
    description: 'A quiet place to write, with agents working beside your words.',
    homepage: 'https://github.com/muzaffermahi/rumi',
    license: 'MIT',
    architecture: {'64bit': {url: url(win), hash: sha(win), extract_dir: 'Rumi-windows-x64'}},
    bin: [['node\\node.exe', 'rumi', 'app\\bin\\rumi.mjs']],
    shortcuts: [['Rumi.cmd', 'Rumi']],
    checkver: {github: 'https://github.com/muzaffermahi/rumi'},
    autoupdate: {
      architecture: {'64bit': {url: 'https://github.com/muzaffermahi/rumi/releases/download/v$version/Rumi-windows-x64.zip', extract_dir: 'Rumi-windows-x64'}},
    },
  };
  fs.writeFileSync(path.join(release, 'rumi.json'), `${JSON.stringify(scoop, null, 2)}\n`);
}
console.log(`Wrote release/rumi.rb${has(win) ? ' and release/rumi.json' : ''} for ${version}`);
