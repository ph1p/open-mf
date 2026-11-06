# Open MF

A small, fast control panel for the **Arturia MiniFuse 4** audio interface. Built with
Tauri 2, React, TypeScript, shadcn/ui and Tailwind 4.

> Open MF is an independent project. It is not affiliated with, endorsed by or supported
> by Arturia. "MiniFuse" is a trademark of its owner.

## Features

- **Mixer** for all three device mixes: Outputs 1–2 (Main), Outputs 3–4 (Cue) and Loopback.
  - Fader, pan, mute and solo per channel; master level and output source per mix.
  - Stereo pairs (USB 1–2, 3–4, 5–6 and linked Inputs 3–4) can show as one strip.
  - Add or remove channels per mix, or show all of them. Removing keeps the pan, so
    re-adding restores it.
  - Mix actions: clear solo, mute or unmute all, reset the mix, copy it to another output.
- **Default positions:** double-click, Alt-click or Backspace resets a control. Right-click
  to reset it, make the current value its default, or reset the whole strip. Factory
  defaults are 0 dB and center pan (stereo pairs hard left and right), except the Main and Cue mix levels: they reset to
  −20 dB to protect speakers and ears.
- **Type a value:** click a dB readout and type `-6`, `0` or `inf`. Enter applies, Esc cancels.
- **Rename channels:** double-click a strip name.
- **Undo and redo** for every change, including presets and copied mixes.
- **Keyboard shortcuts:** `1` `2` `3` switch the mix; `M`, `S` and `R` mute, solo or reset
  the focused strip; Cmd/Ctrl+Z undoes; Cmd+Shift+Z or Ctrl+Y redoes.
- **Live meters** for every channel and bus, with configurable warn level, clip hold and
  peak hold.
- **Inputs:** INST switches, 48 V phantom power, trim for Inputs 3–4, 3–4 stereo link.
- **Presets:** built-in setups plus your own, saved locally. Applying one writes only the
  values that differ.
- **Two-way sync:** changes made in the vendor app show up in Open MF. Polling speeds up
  while the window has focus.
- Custom title bar, light and dark theme. The window remembers its size and position.

Settings and presets live in the webview's `localStorage`.

## Platform support

| OS      | UI  | Device control                                   |
| ------- | --- | ------------------------------------------------ |
| macOS   | yes | yes (IOKit, `src-tauri/csrc/usb_mac.c`)          |
| Windows | yes | not yet: the audio driver owns the USB interface |
| Linux   | yes | not yet: the kernel audio driver owns the device |

On Windows and Linux the app builds and runs, and says that device control is not
supported on this OS.

## Development

Requirements: Node 20+, pnpm, a stable Rust toolchain and the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
pnpm install
pnpm tauri dev               # run the app with hot reload
pnpm check                   # TypeScript
cd src-tauri && cargo test   # protocol encoding tests
pnpm tauri build             # release bundle
```

To change the app icon, edit `src-tauri/icons/app-icon.svg` and run
`pnpm tauri icon src-tauri/icons/app-icon.svg`.

## Layout

```
src/App.tsx                layout: title bar, mixer, inputs and outputs sidebar
src/components/            mixer strips, title bar, menus; ui/ holds shadcn components
src/lib/                   app state and actions, device, presets, settings
src-tauri/src/device.rs    control transfers, meters, clock
src-tauri/src/mixer.rs     typed mixer ops (range-checked before any write)
src-tauri/src/usb.rs       raw USB transport (macOS only for now)
src-tauri/csrc/usb_mac.c   IOKit shim
```

## Protocol notes

Interoperability facts, observed on hardware.

- USB IDs: vendor `0x1C75`, product `0xAF70`.
- Write: class request to interface 0 (`bmRequestType 0x21`), `bRequest 34`,
  `wValue = (param << 8) | index`, `wIndex 0`, payload u16 little-endian.
- Read: `bmRequestType 0xA1`, `bRequest 0xA2`, same `wValue`/`wIndex`.
- Meters: `bRequest 0xC2`, 64 bytes = 16 little-endian u32 linear peaks.
- Mixer buses: 0 = Outputs 1–2, 1 = Outputs 3–4, 2 = Loopback.
  Channels: 0–3 = analog inputs, 4–9 = USB playback 1–6.
- Gains are signed i16 in 1/256 dB; `0x8000` = off. Pan is not stored: the left and right
  crosspoint gains carry fader and pan (sin/cos law, −3.01 dB per side at center).
- The Main bus meter is post-master; the Cue and Loopback meters are pre-master.

Open MF only sends the typed, range-checked requests above. It never sends firmware
update (DFU) requests.

## Credits

The initial INST and 48 V selectors came from
[mf-cli](https://github.com/nolight132/mf-cli) (MIT).

## License

MIT
