// Hocki runs without a console window: Hocki is the whole UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    hocki_lib::run()
}
