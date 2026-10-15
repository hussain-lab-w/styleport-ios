import SwiftUI
import WebKit
import UIKit

@main
struct StylePortApp: App {
    var body: some Scene {
        WindowGroup {
            StylePortWebView()
                .ignoresSafeArea(.container, edges: .bottom)
        }
    }
}

final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private func webRoot() -> URL? {
        if let u = Bundle.main.url(forResource: "Web", withExtension: nil) { return u }
        let candidates = [Bundle.main.bundleURL.appendingPathComponent("Web")]
        return candidates.first { FileManager.default.fileExists(atPath: $0.path) }
    }

    private func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "png": return "image/png"
        case "zip": return "application/zip"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let root = webRoot() else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst()))
        guard let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let headers = [
            "Content-Type": mime(file.pathExtension),
            "Content-Length": "\(data.count)",
            "Access-Control-Allow-Origin": "*"
        ]
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

struct StylePortWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "app")
        configuration.userContentController.add(context.coordinator, name: "saveHeic")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.backgroundColor = UIColor(red: 0.957, green: 0.945, blue: 0.91, alpha: 1)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        context.coordinator.webView = webView

        webView.load(URLRequest(url: URL(string: "app://local/index.html")!))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "saveHeic",
                  let payload = message.body as? [String: Any],
                  let name = payload["name"] as? String,
                  let base64 = payload["base64"] as? String,
                  let data = Data(base64Encoded: base64) else { return }

            let safeName = name.replacingOccurrences(of: "/", with: "-")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
            do {
                try data.write(to: url, options: .atomic)
                presentShareSheet(for: url)
            } catch {
                presentError("تعذر تجهيز ملف HEIC للمشاركة: \(error.localizedDescription)")
            }
        }

        private func presentShareSheet(for url: URL) {
            DispatchQueue.main.async { [weak self] in
                guard let self, let presenter = self.topViewController() else { return }
                let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                if let popover = controller.popoverPresentationController {
                    popover.sourceView = presenter.view
                    popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY - 80, width: 1, height: 1)
                }
                controller.completionWithItemsHandler = { _, _, _, _ in
                    try? FileManager.default.removeItem(at: url)
                }
                presenter.present(controller, animated: true)
            }
        }

        private func presentError(_ message: String) {
            DispatchQueue.main.async { [weak self] in
                guard let presenter = self?.topViewController() else { return }
                let alert = UIAlertController(title: "StylePort", message: message, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "حسنًا", style: .default))
                presenter.present(alert, animated: true)
            }
        }

        private func topViewController() -> UIViewController? {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first(where: { $0.activationState == .foregroundActive })
            var controller = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
            while let presented = controller?.presentedViewController { controller = presented }
            return controller
        }
    }
}
