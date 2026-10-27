use std::path::Path;

fn main() {
    for name in ["xterm.js", "xterm.css", "addon-fit.js"] {
        let path = format!("web/vendor/{name}");
        println!("cargo:rerun-if-changed={path}");
        assert!(Path::new(&path).is_file(), "Missing {path}: run npm install --ignore-scripts && npm run assets first");
    }
    println!("cargo:rerun-if-changed=web/index.html");
    println!("cargo:rerun-if-changed=web/app.js");
    println!("cargo:rerun-if-changed=web/style.css");
    println!("cargo:rerun-if-changed=web/session.html");
    println!("cargo:rerun-if-changed=web/workspace.js");
    println!("cargo:rerun-if-changed=web/workspace.css");
    for name in ["i18n.js", "i18n-copy.js", "i18n-traditional.js"] { println!("cargo:rerun-if-changed=web/{name}"); }
}

