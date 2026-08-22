package data

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/santifer/career-ops/dashboard/internal/model"
)

var (
	reReportLink     = regexp.MustCompile(`\[(\d+)\]\(([^)]+)\)`)
	reScoreValue     = regexp.MustCompile(`^\s*([0-9]+(\.[0-9]+)?)(\s*/\s*(5|100)|\s*%)?\s*$`)
	reArchetype      = regexp.MustCompile(`(?i)\*\*Arquetipo(?:\s+detectado)?\*\*\s*\|\s*(.+)`)
	reTlDr           = regexp.MustCompile(`(?i)\*\*TL;DR\*\*\s*\|\s*(.+)`)
	reTlDrColon      = regexp.MustCompile(`(?i)\*\*TL;DR:\*\*\s*(.+)`)
	reRemote         = regexp.MustCompile(`(?i)\*\*Remote\*\*\s*\|\s*(.+)`)
	reComp           = regexp.MustCompile(`(?i)\*\*Comp\*\*\s*\|\s*(.+)`)
	reArchetypeColon = regexp.MustCompile(`(?i)\*\*Arquetipo:\*\*\s*(.+)`)
	reReportURL      = regexp.MustCompile(`(?m)^\*\*URL:\*\*\s*(https?://\S+)`)
	reBatchID        = regexp.MustCompile(`(?m)^\*\*Batch ID:\*\*\s*(\d+)`)
)

// ParseApplications reads applications.md and returns parsed applications.
// It tries both {path}/applications.md and {path}/data/applications.md for compatibility.
func ParseApplications(careerOpsPath string) []model.CareerApplication {
	filePath := filepath.Join(careerOpsPath, "applications.md")
	content, err := os.ReadFile(filePath)
	if err != nil {
		// Fallback: try data/ subdirectory
		filePath = filepath.Join(careerOpsPath, "data", "applications.md")
		content, err = os.ReadFile(filePath)
		if err != nil {
			return nil
		}
	}

	lines := strings.Split(string(content), "\n")
	apps := make([]model.CareerApplication, 0)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "# ") || strings.HasPrefix(line, "|---") || strings.HasPrefix(line, "| #") {
			continue
		}
		if !strings.HasPrefix(line, "|") {
			continue
		}

		// Detect delimiter: if line contains tabs, use tab-aware splitting
		var fields []string
		if strings.Contains(line, "\t") {
			// Mixed format: starts with "| " then tab-separated
			line = strings.TrimPrefix(line, "|")
			line = strings.TrimSpace(line)
			parts := strings.Split(line, "\t")
			for _, p := range parts {
				fields = append(fields, strings.TrimSpace(strings.Trim(p, "|")))
			}
		} else {
			// Pure pipe format
			line = strings.Trim(line, "|")
			parts := strings.Split(line, "|")
			for _, p := range parts {
				fields = append(fields, strings.TrimSpace(p))
			}
		}

		if len(fields) < 8 {
			continue
		}

		trackerNumber, err := strconv.Atoi(strings.TrimSpace(fields[0]))
		if err != nil || trackerNumber <= 0 {
			continue
		}

		app := model.CareerApplication{
			Number:  trackerNumber,
			Date:    fields[1],
			Company: fields[2],
			Role:    fields[3],
			Status:  fields[5],
			HasPDF:  strings.Contains(fields[6], "\u2705"),
		}

		// Parse score (field 4 = Score column)
		app.ScoreRaw = fields[4]
		if sm := reScoreValue.FindStringSubmatch(fields[4]); sm != nil {
			score, _ := strconv.ParseFloat(sm[1], 64)
			if sm[4] == "5" {
				score *= 20
			}
			app.Score = score
		}

		// Parse report link
		if rm := reReportLink.FindStringSubmatch(fields[7]); rm != nil {
			app.ReportNumber = rm[1]
			app.ReportPath = rm[2]
		}

		// Notes (field 8 if exists)
		if len(fields) > 8 {
			app.Notes = fields[8]
		}

		apps = append(apps, app)
	}

	// Enrich with job URLs using 5-tier strategy:
	// 1. **URL:** field in report header (newest reports)
	// 2. **Batch ID:** in report -> batch-input.tsv URL lookup
	// 3. report_num -> batch-state completed mapping (legacy)
	// 4. scan-history.tsv (pipeline scan entries matched by company+role)
	// 5. company name fallback from batch-input.tsv
	batchURLs := loadBatchInputURLs(careerOpsPath)
	reportNumURLs := loadJobURLs(careerOpsPath)

	for i := range apps {
		if apps[i].ReportPath == "" {
			continue
		}
		fullReport := filepath.Join(careerOpsPath, apps[i].ReportPath)
		reportContent, err := os.ReadFile(fullReport)
		if err != nil {
			continue
		}
		header := string(reportContent)
		// Only scan the header (first 1000 bytes) for speed
		if len(header) > 1000 {
			header = header[:1000]
		}

		// Strategy 1: **URL:** in report
		if m := reReportURL.FindStringSubmatch(header); m != nil {
			apps[i].JobURL = m[1]
			continue
		}

		// Strategy 2: **Batch ID:** -> batch-input.tsv
		if m := reBatchID.FindStringSubmatch(header); m != nil {
			if url, ok := batchURLs[m[1]]; ok {
				apps[i].JobURL = url
				continue
			}
		}

		// Strategy 3: report_num -> batch-state completed mapping
		if reportNumURLs != nil {
			if url, ok := reportNumURLs[apps[i].ReportNumber]; ok {
				apps[i].JobURL = url
				continue
			}
		}
	}

	// Strategy 4: scan-history.tsv (pipeline scan entries matched by company+role)
	enrichFromScanHistory(careerOpsPath, apps)

	// Strategy 5: company name fallback from batch-input.tsv
	enrichAppURLsByCompany(careerOpsPath, apps)
	enrichApplicationActions(careerOpsPath, apps)
	enrichFollowups(careerOpsPath, apps)

	return apps
}

func enrichApplicationActions(careerOpsPath string, apps []model.CareerApplication) {
	filePath := filepath.Join(careerOpsPath, "data", "application-actions.tsv")
	content, err := os.ReadFile(filePath)
	if err != nil {
		return
	}

	type actionRecord struct {
		channel   string
		applyURL  string
		recipient string
		status    string
		blocker   string
		next      string
	}
	records := make(map[string]actionRecord)
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "id\t") {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 11 {
			continue
		}
		reportNumber := strings.TrimSpace(fields[2])
		if reportNumber == "" {
			continue
		}
		records[reportNumber] = actionRecord{
			channel:   strings.TrimSpace(fields[5]),
			applyURL:  strings.TrimSpace(fields[6]),
			recipient: strings.TrimSpace(fields[7]),
			status:    strings.TrimSpace(fields[8]),
			blocker:   strings.TrimSpace(fields[9]),
			next:      strings.TrimSpace(fields[10]),
		}
	}

	for i := range apps {
		record, ok := records[apps[i].ReportNumber]
		if !ok {
			continue
		}
		apps[i].ApplyChannel = record.channel
		apps[i].ApplyURL = record.applyURL
		apps[i].ApplyRecipient = record.recipient
		apps[i].ApplyStatus = record.status
		apps[i].ApplyBlocker = record.blocker
		apps[i].ApplyNext = record.next
		if apps[i].JobURL == "" && strings.HasPrefix(record.applyURL, "http") {
			apps[i].JobURL = record.applyURL
		}
	}
}

type followupRecord struct {
	ID             string
	ReportNumber   string
	Company        string
	Role           string
	AppliedAt      string
	LastContact    string
	FollowupDue    string
	ContactChannel string
	ContactName    string
	NextAction     string
	Notes          string
	UpdatedAt      string
}

func enrichFollowups(careerOpsPath string, apps []model.CareerApplication) {
	records := loadFollowupRecords(careerOpsPath)
	for i := range apps {
		key := followupKey(apps[i])
		if record, ok := records[key]; ok {
			apps[i].AppliedAt = record.AppliedAt
			apps[i].LastContact = record.LastContact
			apps[i].FollowupDue = record.FollowupDue
			apps[i].ContactChannel = record.ContactChannel
			apps[i].ContactName = record.ContactName
			apps[i].NextAction = record.NextAction
			apps[i].FollowupNotes = record.Notes
		}
		if strings.TrimSpace(apps[i].NextAction) == "" {
			apps[i].NextAction = defaultNextAction(apps[i])
		}
	}
}

func loadFollowupRecords(careerOpsPath string) map[string]followupRecord {
	filePath := applicationFollowupsPath(careerOpsPath)
	content, err := os.ReadFile(filePath)
	if err != nil {
		return map[string]followupRecord{}
	}

	records := make(map[string]followupRecord)
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "id\t") {
			continue
		}
		fields := strings.Split(line, "\t")
		for len(fields) < 12 {
			fields = append(fields, "")
		}
		record := followupRecord{
			ID:             fields[0],
			ReportNumber:   fields[1],
			Company:        fields[2],
			Role:           fields[3],
			AppliedAt:      fields[4],
			LastContact:    fields[5],
			FollowupDue:    fields[6],
			ContactChannel: fields[7],
			ContactName:    fields[8],
			NextAction:     fields[9],
			Notes:          fields[10],
			UpdatedAt:      fields[11],
		}
		key := strings.TrimSpace(record.ReportNumber)
		if key == "" {
			key = strings.TrimSpace(record.ID)
		}
		if key != "" {
			records[key] = record
		}
	}
	return records
}

// UpsertFollowupForStatusChange keeps application-followups.tsv in sync with dashboard status changes.
func UpsertFollowupForStatusChange(careerOpsPath string, app model.CareerApplication, newStatus string) error {
	records := loadFollowupRecords(careerOpsPath)
	key := followupKey(app)
	if key == "" {
		return nil
	}

	today := time.Now().Format("2006-01-02")
	record := records[key]
	record.ID = strconv.Itoa(app.Number)
	record.ReportNumber = app.ReportNumber
	record.Company = app.Company
	record.Role = app.Role
	record.UpdatedAt = today

	switch NormalizeStatus(newStatus) {
	case "scheduled":
		record.FollowupDue = ""
		record.NextAction = "Email scheduled in Gmail; wait for confirmed delivery before starting follow-up."
	case "applied":
		if record.AppliedAt == "" {
			record.AppliedAt = today
		}
		if record.LastContact == "" {
			record.LastContact = today
		}
		if record.FollowupDue == "" {
			record.FollowupDue = time.Now().AddDate(0, 0, 7).Format("2006-01-02")
		}
		record.NextAction = "Follow up if there is no response by the due date."
	case "responded":
		record.LastContact = today
		record.FollowupDue = time.Now().AddDate(0, 0, 3).Format("2006-01-02")
		record.NextAction = "Reply or clarify next step; follow up if pending."
	case "interview":
		record.LastContact = today
		record.FollowupDue = time.Now().AddDate(0, 0, 1).Format("2006-01-02")
		record.NextAction = "Prepare interview notes and confirm schedule."
	case "offer":
		record.LastContact = today
		record.FollowupDue = time.Now().AddDate(0, 0, 2).Format("2006-01-02")
		record.NextAction = "Review offer details and prepare response."
	case "skip", "rejected", "discarded":
		record.FollowupDue = ""
		record.NextAction = "Closed - no follow-up."
	default:
		record.NextAction = defaultNextAction(app)
	}

	records[key] = record
	return writeFollowupRecords(careerOpsPath, records)
}

func writeFollowupRecords(careerOpsPath string, records map[string]followupRecord) error {
	filePath := applicationFollowupsPath(careerOpsPath)
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return err
	}

	keys := make([]string, 0, len(records))
	for key := range records {
		keys = append(keys, key)
	}
	sortFollowupKeys(keys)

	var lines []string
	lines = append(lines, "id\treport_number\tcompany\trole\tapplied_at\tlast_contact\tfollowup_due\tcontact_channel\tcontact_name\tnext_action\tnotes\tupdated_at")
	for _, key := range keys {
		record := records[key]
		lines = append(lines, strings.Join([]string{
			tsvCell(record.ID),
			tsvCell(record.ReportNumber),
			tsvCell(record.Company),
			tsvCell(record.Role),
			tsvCell(record.AppliedAt),
			tsvCell(record.LastContact),
			tsvCell(record.FollowupDue),
			tsvCell(record.ContactChannel),
			tsvCell(record.ContactName),
			tsvCell(record.NextAction),
			tsvCell(record.Notes),
			tsvCell(record.UpdatedAt),
		}, "\t"))
	}
	return os.WriteFile(filePath, []byte(strings.Join(lines, "\n")+"\n"), 0644)
}

func sortFollowupKeys(keys []string) {
	sort.SliceStable(keys, func(i, j int) bool {
		left, leftErr := strconv.Atoi(strings.TrimLeft(keys[i], "0"))
		right, rightErr := strconv.Atoi(strings.TrimLeft(keys[j], "0"))
		if leftErr == nil && rightErr == nil {
			return left < right
		}
		return keys[i] < keys[j]
	})
}

func applicationFollowupsPath(careerOpsPath string) string {
	return filepath.Join(careerOpsPath, "data", "application-followups.tsv")
}

func followupKey(app model.CareerApplication) string {
	if strings.TrimSpace(app.ReportNumber) != "" {
		return strings.TrimSpace(app.ReportNumber)
	}
	if app.Number > 0 {
		return strconv.Itoa(app.Number)
	}
	return ""
}

func defaultNextAction(app model.CareerApplication) string {
	switch NormalizeStatus(app.Status) {
	case "evaluated":
		return "Review report, confirm red flags, then apply manually or skip."
	case "scheduled":
		return "Email scheduled in Gmail; wait for confirmed delivery before starting follow-up."
	case "applied":
		return "Wait for response; set or review follow-up date."
	case "responded":
		return "Reply or clarify next step."
	case "interview":
		return "Prepare interview notes and confirm schedule."
	case "offer":
		return "Review offer details and prepare response."
	case "skip", "rejected", "discarded":
		return "Closed - no follow-up."
	default:
		return "Review next action."
	}
}

func tsvCell(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(value), "\t", " "), "\n", " ")
}

// loadBatchInputURLs reads batch-input.tsv and returns a map of batch ID -> job URL.
func loadBatchInputURLs(careerOpsPath string) map[string]string {
	inputPath := filepath.Join(careerOpsPath, "batch", "batch-input.tsv")
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return nil
	}
	result := make(map[string]string)
	for _, line := range strings.Split(string(inputData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 4 || fields[0] == "id" {
			continue
		}
		id := fields[0]
		notes := fields[3]
		// Extract real job URL from notes: "Title @ Company | Match% | https://actual-url"
		if idx := strings.LastIndex(notes, "| "); idx >= 0 {
			u := strings.TrimSpace(notes[idx+2:])
			if strings.HasPrefix(u, "http") {
				result[id] = u
				continue
			}
		}
		// Fallback: use JackJill URL
		if strings.HasPrefix(fields[1], "http") {
			result[id] = fields[1]
		}
	}
	return result
}

// batchEntry holds parsed data from batch-input.tsv.
type batchEntry struct {
	id      string
	url     string
	company string
	role    string
}

// loadJobURLs reads batch TSV files and returns a map of report_num -> job URL.
// Uses two strategies: (1) report_num mapping for completed jobs, (2) company name
// matching as fallback for failed/missing jobs.
func loadJobURLs(careerOpsPath string) map[string]string {
	// Read batch-input.tsv: id \t url \t source \t notes
	inputPath := filepath.Join(careerOpsPath, "batch", "batch-input.tsv")
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return nil
	}

	// Parse batch-input: extract job URL, company, and role from notes
	entries := make(map[string]batchEntry) // keyed by id
	for _, line := range strings.Split(string(inputData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 4 || fields[0] == "id" {
			continue
		}
		e := batchEntry{id: fields[0]}
		notes := fields[3]

		// Extract URL from notes: "Title @ Company | Match% | https://actual-url"
		if idx := strings.LastIndex(notes, "| "); idx >= 0 {
			u := strings.TrimSpace(notes[idx+2:])
			if strings.HasPrefix(u, "http") {
				e.url = u
			}
		}
		// Fallback: use JackJill URL from field 1
		if e.url == "" && strings.HasPrefix(fields[1], "http") {
			e.url = fields[1]
		}

		// Extract company and role: "Role @ Company | Match% | URL"
		notesPart := notes
		if pipeIdx := strings.Index(notesPart, " | "); pipeIdx >= 0 {
			notesPart = notesPart[:pipeIdx]
		}
		if atIdx := strings.LastIndex(notesPart, " @ "); atIdx >= 0 {
			e.role = strings.TrimSpace(notesPart[:atIdx])
			e.company = strings.TrimSpace(notesPart[atIdx+3:])
		}

		if e.url != "" {
			entries[fields[0]] = e
		}
	}

	// Read batch-state.tsv: id \t url \t status \t ... \t report_num \t ...
	statePath := filepath.Join(careerOpsPath, "batch", "batch-state.tsv")
	stateData, err := os.ReadFile(statePath)
	if err != nil {
		return nil
	}

	// Strategy 1: map report_num -> URL only for COMPLETED jobs
	reportToURL := make(map[string]string)
	for _, line := range strings.Split(string(stateData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 6 || fields[0] == "id" {
			continue
		}
		id := fields[0]
		status := fields[2]
		reportNum := fields[5]
		if status != "completed" || reportNum == "" || reportNum == "-" {
			continue
		}
		if e, ok := entries[id]; ok {
			reportToURL[reportNum] = e.url
			if len(reportNum) < 3 {
				reportToURL[fmt.Sprintf("%03s", reportNum)] = e.url
			}
		}
	}

	return reportToURL
}

// enrichFromScanHistory fills JobURL from scan-history.tsv by matching company name.
func enrichFromScanHistory(careerOpsPath string, apps []model.CareerApplication) {
	scanPath := filepath.Join(careerOpsPath, "scan-history.tsv")
	scanData, err := os.ReadFile(scanPath)
	if err != nil {
		return
	}

	// Build company -> URL index from scan-history
	type scanEntry struct {
		url     string
		company string
		title   string
	}
	byCompany := make(map[string][]scanEntry)
	for _, line := range strings.Split(string(scanData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 5 || fields[0] == "url" {
			continue
		}
		url := fields[0]
		company := fields[4]
		title := fields[3]
		if url == "" || !strings.HasPrefix(url, "http") {
			continue
		}
		key := normalizeCompany(company)
		byCompany[key] = append(byCompany[key], scanEntry{url: url, company: company, title: title})
	}

	for i := range apps {
		if apps[i].JobURL != "" {
			continue
		}
		key := normalizeCompany(apps[i].Company)
		matches := byCompany[key]
		if len(matches) == 1 {
			apps[i].JobURL = matches[0].url
		} else if len(matches) > 1 {
			// Multiple entries: pick best role match
			appRole := strings.ToLower(apps[i].Role)
			best := matches[0].url
			bestScore := 0
			for _, m := range matches {
				score := 0
				mTitle := strings.ToLower(m.title)
				for _, word := range strings.Fields(appRole) {
					if len(word) > 2 && strings.Contains(mTitle, word) {
						score++
					}
				}
				if score > bestScore {
					bestScore = score
					best = m.url
				}
			}
			apps[i].JobURL = best
		}
	}
}

// normalizeCompany strips common suffixes and lowercases a company name.
func normalizeCompany(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	for _, suffix := range []string{" inc.", " inc", " llc", " ltd", " corp", " corporation", " technologies", " technology", " group", " co."} {
		s = strings.TrimSuffix(s, suffix)
	}
	return strings.TrimSpace(s)
}

// enrichAppURLsByCompany fills in JobURL for apps that didn't get one via report_num mapping.
// It matches by company name from batch-input.tsv notes.
func enrichAppURLsByCompany(careerOpsPath string, apps []model.CareerApplication) {
	inputPath := filepath.Join(careerOpsPath, "batch", "batch-input.tsv")
	inputData, err := os.ReadFile(inputPath)
	if err != nil {
		return
	}

	// Build company -> []entry index
	type entry struct {
		role string
		url  string
	}
	byCompany := make(map[string][]entry)
	for _, line := range strings.Split(string(inputData), "\n") {
		fields := strings.Split(line, "\t")
		if len(fields) < 4 || fields[0] == "id" {
			continue
		}
		notes := fields[3]
		var url string
		if idx := strings.LastIndex(notes, "| "); idx >= 0 {
			u := strings.TrimSpace(notes[idx+2:])
			if strings.HasPrefix(u, "http") {
				url = u
			}
		}
		if url == "" && strings.HasPrefix(fields[1], "http") {
			url = fields[1]
		}
		if url == "" {
			continue
		}
		notesPart := notes
		if pipeIdx := strings.Index(notesPart, " | "); pipeIdx >= 0 {
			notesPart = notesPart[:pipeIdx]
		}
		if atIdx := strings.LastIndex(notesPart, " @ "); atIdx >= 0 {
			role := strings.TrimSpace(notesPart[:atIdx])
			company := strings.TrimSpace(notesPart[atIdx+3:])
			key := normalizeCompany(company)
			byCompany[key] = append(byCompany[key], entry{role: role, url: url})
		}
	}

	for i := range apps {
		if apps[i].JobURL != "" {
			continue
		}
		key := normalizeCompany(apps[i].Company)
		matches := byCompany[key]
		if len(matches) == 1 {
			apps[i].JobURL = matches[0].url
		} else if len(matches) > 1 {
			// Multiple entries for same company: pick best role match
			appRole := strings.ToLower(apps[i].Role)
			best := matches[0].url
			bestScore := 0
			for _, m := range matches {
				score := 0
				mRole := strings.ToLower(m.role)
				// Count matching words
				for _, word := range strings.Fields(appRole) {
					if len(word) > 2 && strings.Contains(mRole, word) {
						score++
					}
				}
				if score > bestScore {
					bestScore = score
					best = m.url
				}
			}
			apps[i].JobURL = best
		}
	}
}

// ComputeMetrics calculates aggregate metrics from applications.
func ComputeMetrics(apps []model.CareerApplication) model.PipelineMetrics {
	m := model.PipelineMetrics{
		Total:    len(apps),
		ByStatus: make(map[string]int),
	}

	var totalScore float64
	var scored int

	for _, app := range apps {
		status := NormalizeStatus(app.Status)
		m.ByStatus[status]++

		if app.Score > 0 {
			totalScore += app.Score
			scored++
			if app.Score > m.TopScore {
				m.TopScore = app.Score
			}
		}
		if app.HasPDF {
			m.WithPDF++
		}
		if status != "skip" && status != "rejected" && status != "discarded" {
			m.Actionable++
		}
		if strings.TrimSpace(app.NextAction) != "" && status != "skip" && status != "rejected" && status != "discarded" {
			m.NeedsAction++
		}
		if followupIsDue(app.FollowupDue) && status != "skip" && status != "rejected" && status != "discarded" {
			m.FollowupDue++
		}
	}

	if scored > 0 {
		m.AvgScore = totalScore / float64(scored)
	}

	return m
}

func followupIsDue(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	due, err := time.Parse("2006-01-02", value)
	if err != nil {
		return false
	}
	today, _ := time.Parse("2006-01-02", time.Now().Format("2006-01-02"))
	return !due.After(today)
}

// NormalizeStatus normalizes raw status text to a canonical form.
// Aliases match states.yml -- keep in sync with career-ops/states.yml
func NormalizeStatus(raw string) string {
	// Strip markdown bold and trailing dates
	s := strings.ReplaceAll(raw, "**", "")
	s = strings.TrimSpace(strings.ToLower(s))
	// Strip trailing date (e.g., "aplicado 2026-03-12")
	if idx := strings.Index(s, " 202"); idx > 0 {
		s = strings.TrimSpace(s[:idx])
	}

	switch {
	// Most restrictive first — accepts both English and Spanish
	case strings.Contains(s, "no aplicar") || strings.Contains(s, "no_aplicar") || s == "skip" || strings.Contains(s, "geo blocker"):
		return "skip"
	case strings.Contains(s, "interview") || strings.Contains(s, "entrevista"):
		return "interview"
	case s == "offer" || strings.Contains(s, "oferta"):
		return "offer"
	case strings.Contains(s, "responded") || strings.Contains(s, "respondido"):
		return "responded"
	case strings.Contains(s, "scheduled") || s == "agendado" || s == "agendada":
		return "scheduled"
	case strings.Contains(s, "applied") || strings.Contains(s, "aplicado") || s == "enviada" || s == "aplicada" || s == "sent":
		return "applied"
	case strings.Contains(s, "rejected") || strings.Contains(s, "rechazado") || s == "rechazada":
		return "rejected"
	case strings.Contains(s, "discarded") || strings.Contains(s, "descartado") || s == "descartada" || s == "cerrada" || s == "cancelada" ||
		strings.HasPrefix(s, "duplicado") || strings.HasPrefix(s, "dup"):
		return "discarded"
	case strings.Contains(s, "evaluated") || strings.Contains(s, "evaluada") || s == "condicional" || s == "hold" || s == "monitor" || s == "evaluar" || s == "verificar":
		return "evaluated"
	default:
		return s
	}
}

// LoadReportSummary extracts key fields from a report file.
func LoadReportSummary(careerOpsPath, reportPath string) (archetype, tldr, remote, comp string) {
	fullPath := filepath.Join(careerOpsPath, reportPath)
	content, err := os.ReadFile(fullPath)
	if err != nil {
		return
	}
	text := string(content)

	if m := reArchetype.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	} else if m := reArchetypeColon.FindStringSubmatch(text); m != nil {
		archetype = cleanTableCell(m[1])
	}

	// Try table-format TL;DR first (most reports), then colon format
	if m := reTlDr.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	} else if m := reTlDrColon.FindStringSubmatch(text); m != nil {
		tldr = cleanTableCell(m[1])
	}

	if m := reRemote.FindStringSubmatch(text); m != nil {
		remote = cleanTableCell(m[1])
	}

	if m := reComp.FindStringSubmatch(text); m != nil {
		comp = cleanTableCell(m[1])
	}

	// Truncate long fields
	if len(tldr) > 120 {
		tldr = tldr[:117] + "..."
	}

	return
}

// UpdateApplicationStatus updates the status of an application in applications.md.
func UpdateApplicationStatus(careerOpsPath string, app model.CareerApplication, newStatus string) error {
	filePath := filepath.Join(careerOpsPath, "applications.md")
	content, err := os.ReadFile(filePath)
	if err != nil {
		filePath = filepath.Join(careerOpsPath, "data", "applications.md")
		content, err = os.ReadFile(filePath)
		if err != nil {
			return err
		}
	}

	lines := strings.Split(string(content), "\n")
	found := false

	for i, line := range lines {
		if !strings.HasPrefix(strings.TrimSpace(line), "|") {
			continue
		}
		// Match by report number
		if app.ReportNumber != "" && strings.Contains(line, fmt.Sprintf("[%s]", app.ReportNumber)) {
			// Replace the status field
			lines[i] = replaceStatusInLine(line, app.Status, newStatus)
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("application not found: report %s", app.ReportNumber)
	}

	return os.WriteFile(filePath, []byte(strings.Join(lines, "\n")), 0644)
}

// replaceStatusInLine replaces the old status with new status in a table line.
func replaceStatusInLine(line, oldStatus, newStatus string) string {
	// Case-insensitive replacement of the status field
	return strings.Replace(line, oldStatus, newStatus, 1)
}

// cleanTableCell removes trailing pipes and whitespace from a table cell value.
func cleanTableCell(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimRight(s, "|")
	return strings.TrimSpace(s)
}

// StatusPriority returns the sort priority for a status (lower = higher priority).
func StatusPriority(status string) int {
	switch NormalizeStatus(status) {
	case "interview":
		return 0
	case "offer":
		return 1
	case "responded":
		return 2
	case "applied":
		return 3
	case "scheduled":
		return 4
	case "evaluated":
		return 5
	case "skip":
		return 6
	case "rejected":
		return 7
	case "discarded":
		return 8
	default:
		return 9
	}
}
