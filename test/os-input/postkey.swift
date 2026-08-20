import CoreGraphics
import Foundation

// usage: postkey <mode:pid|tap> <pid> key <keycode> [cmd]
//        postkey <mode:pid|tap> <pid> mouse <button> <x> <y>
let a = CommandLine.arguments
guard a.count >= 4, let pid = pid_t(a[2]) else { exit(2) }
let mode = a[1]
let src = CGEventSource(stateID: .hidSystemState)
func emit(_ e: CGEvent) { if mode == "tap" { e.post(tap: .cghidEventTap) } else { e.postToPid(pid) } }

if a[3] == "key" {
    guard let code = UInt16(a[4]) else { exit(2) }
    var flags: CGEventFlags = []
    if a.count > 5 && a[5] == "cmd" { flags.insert(.maskCommand) }
    let down = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true)!
    let up = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false)!
    down.flags = flags; up.flags = flags
    emit(down); usleep(50000); emit(up)
    print("posted key \(code) flags=\(flags.rawValue) mode=\(mode)")
} else if a[3] == "mouse" {
    guard let btn = UInt32(a[4]), let x = Double(a[5]), let y = Double(a[6]) else { exit(2) }
    let holdUs = a.count > 7 ? (UInt32(a[7]) ?? 50000) : 50000
    let pos = CGPoint(x: x, y: y)
    let saved = CGEvent(source: nil)!.location
    CGWarpMouseCursorPosition(pos)
    usleep(120000)
    let down = CGEvent(mouseEventSource: src, mouseType: .otherMouseDown,
                       mouseCursorPosition: pos, mouseButton: CGMouseButton(rawValue: btn)!)!
    let up = CGEvent(mouseEventSource: src, mouseType: .otherMouseUp,
                     mouseCursorPosition: pos, mouseButton: CGMouseButton(rawValue: btn)!)!
    emit(down); usleep(holdUs); emit(up)
    usleep(120000)
    CGWarpMouseCursorPosition(saved)
    print("posted mouse button \(btn) at \(x),\(y) mode=\(mode)")
}
