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

struct StylePortWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.add(context.coordinator, name: "saveHeic")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.backgroundColor = UIColor(red: 0.957, green: 0.945, blue: 0.91, alpha: 1)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        context.coordinator.webView = webView

        guard let webRoot = Bundle.main.url(forResource: "Web", withExtension: nil),
              let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            return webView
        }
        webView.loadFileURL(index, allowingReadAccessTo: webRoot)
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
