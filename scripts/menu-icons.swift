// Draws one SVG into a square PNG with AppKit, which reads SVG on macOS 14 and later.
// Usage: swift menu-icons.swift <in.svg> <out.png> <pixels>
import AppKit

let args = CommandLine.arguments
guard args.count == 4, let pixels = Int(args[3]),
      let data = FileManager.default.contents(atPath: args[1]),
      let image = NSImage(data: data) else {
    FileHandle.standardError.write("usage: menu-icons.swift <in.svg> <out.png> <pixels>\n".data(using: .utf8)!)
    exit(1)
}
let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels))
NSGraphicsContext.restoreGraphicsState()
try! bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
