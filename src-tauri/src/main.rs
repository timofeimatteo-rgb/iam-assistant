// Не показывать консольное окно в Windows в релизной сборке
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    iam_assistant_lib::run()
}
