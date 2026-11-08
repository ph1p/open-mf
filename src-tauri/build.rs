fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        // Apple's ar: a GNU ar earlier in PATH (Homebrew binutils) writes misaligned
        // Mach-O members that ld then ignores.
        let ar = if std::path::Path::new("/usr/bin/ar").exists() { Some("/usr/bin/ar") } else { None };
        for (file, lib) in [("csrc/usb_mac.c", "usb_mac"), ("csrc/audio_mac.c", "audio_mac")] {
            let mut b = cc::Build::new();
            if let Some(ar) = ar {
                b.archiver(ar);
            }
            b.file(file).compile(lib);
        }
        let mut b = cc::Build::new();
        if let Some(ar) = ar {
            b.archiver(ar);
        }
        b.file("csrc/mediakeys_mac.m").flag("-fobjc-arc").compile("mediakeys_mac");
        println!("cargo:rerun-if-changed=csrc/mediakeys_mac.m");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=ApplicationServices");
        println!("cargo:rerun-if-changed=csrc/audio_mac.c");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rerun-if-changed=csrc/usb_mac.c");
        println!("cargo:rustc-link-lib=framework=IOKit");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
    }
    tauri_build::build()
}
