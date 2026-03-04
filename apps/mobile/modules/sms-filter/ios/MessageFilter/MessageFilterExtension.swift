import IdentityLookup

/**
 * iOS SMS/MMS Message Filter Extension.
 * Implements ILMessageFilterQueryHandling to classify unknown sender messages.
 *
 * This extension runs in a sandboxed environment with limited capabilities.
 * It uses local pattern matching and the shared offline threat database.
 */
final class MessageFilterExtension: ILMessageFilterExtension {}

extension MessageFilterExtension: ILMessageFilterQueryHandling {
    func handle(
        _ queryRequest: ILMessageFilterQueryRequest,
        context: ILMessageFilterExtensionContext,
        completion: @escaping (ILMessageFilterQueryResponse) -> Void
    ) {
        let response = ILMessageFilterQueryResponse()

        guard let messageBody = queryRequest.messageBody else {
            response.action = .allow
            completion(response)
            return
        }

        // Check for common scam patterns
        if containsScamPatterns(messageBody) {
            response.action = .junk
            completion(response)
            return
        }

        // Check URLs in the message against offline database
        let urls = extractURLs(from: messageBody)
        for url in urls {
            if let domain = URL(string: url)?.host,
               isDomainInThreatDB(domain) {
                response.action = .junk
                completion(response)
                return
            }
        }

        // Allow message through
        response.action = .allow
        completion(response)
    }

    private func containsScamPatterns(_ text: String) -> Bool {
        let lowered = text.lowercased()
        let patterns = [
            "click here to verify your account",
            "your package could not be delivered",
            "suspicious activity on your account",
            "your account will be suspended",
            "urgent: update your payment",
            "you have won a prize",
            "claim your reward now",
            "verify your identity immediately",
            "your tax refund is ready",
            "ato refund",
            "centrelink payment",
            "medicare rebate",
            "mygovid verification",
        ]

        return patterns.contains { lowered.contains($0) }
    }

    private func extractURLs(from text: String) -> [String] {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else {
            return []
        }

        let matches = detector.matches(in: text, range: NSRange(text.startIndex..., in: text))
        return matches.compactMap { match in
            guard let range = Range(match.range, in: text) else { return nil }
            return String(text[range])
        }
    }

    private func isDomainInThreatDB(_ domain: String) -> Bool {
        // Access shared App Group container for the offline database
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.au.askarthur.app"
        ) else {
            return false
        }

        let dbPath = containerURL.appendingPathComponent("arthur_threats.db").path

        guard FileManager.default.fileExists(atPath: dbPath),
              let db = try? SQLiteConnection(path: dbPath) else {
            return false
        }

        // Simple check — look for exact domain match
        return db.exists(domain: domain.lowercased())
    }
}

// Minimal SQLite wrapper for the filter extension sandbox
private class SQLiteConnection {
    private var db: OpaquePointer?

    init(path: String) throws {
        var dbPointer: OpaquePointer?
        guard sqlite3_open_v2(path, &dbPointer, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
            throw NSError(domain: "SQLite", code: -1)
        }
        self.db = dbPointer
    }

    func exists(domain: String) -> Bool {
        var stmt: OpaquePointer?
        let query = "SELECT 1 FROM threat_domains WHERE domain = ? LIMIT 1"

        guard sqlite3_prepare_v2(db, query, -1, &stmt, nil) == SQLITE_OK else {
            return false
        }

        sqlite3_bind_text(stmt, 1, (domain as NSString).utf8String, -1, nil)
        let found = sqlite3_step(stmt) == SQLITE_ROW
        sqlite3_finalize(stmt)
        return found
    }

    deinit {
        sqlite3_close(db)
    }
}
