package screens

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"github.com/santifer/career-ops/dashboard/internal/data"
	"github.com/santifer/career-ops/dashboard/internal/model"
	"github.com/santifer/career-ops/dashboard/internal/theme"
)

// PipelineClosedMsg is emitted when the pipeline screen is dismissed.
type PipelineClosedMsg struct{}

// PipelineOpenReportMsg is emitted when a report should be opened in FileViewer.
type PipelineOpenReportMsg struct {
	Path   string
	Title  string
	JobURL string
}

// PipelineOpenURLMsg is emitted when a job URL should be opened in browser.
type PipelineOpenURLMsg struct {
	URL string
}

// PipelineLoadReportMsg requests lazy loading of a report summary.
type PipelineLoadReportMsg struct {
	CareerOpsPath string
	ReportPath    string
}

// PipelineUpdateStatusMsg requests a status update for an application.
type PipelineUpdateStatusMsg struct {
	CareerOpsPath string
	App           model.CareerApplication
	NewStatus     string
}

// PipelineToolAction describes a safe local CareerOps command exposed in the dashboard.
type PipelineToolAction struct {
	ID            string
	Label         string
	Description   string
	Writes        bool
	ApplicationID int
}

// PipelineRunActionMsg requests execution of a local CareerOps tool action.
type PipelineRunActionMsg struct {
	Action PipelineToolAction
}

// PipelineActionFinishedMsg reports the result of a local CareerOps tool action.
type PipelineActionFinishedMsg struct {
	Action           PipelineToolAction
	Succeeded        bool
	Blocked          bool
	Output           string
	RefreshDashboard bool
}

type reportSummary struct {
	archetype string
	tldr      string
	remote    string
	comp      string
}

// Sort modes
const (
	sortScore   = "score"
	sortDate    = "date"
	sortCompany = "company"
	sortStatus  = "status"
)

// Filter modes
const (
	filterAll       = "all"
	filterEvaluated = "evaluated"
	filterScheduled = "scheduled"
	filterApplied   = "applied"
	filterInterview = "interview"
	filterSkip      = "skip"
	filterTop       = "top"
)

type pipelineTab struct {
	filter string
	label  string
}

var pipelineTabs = []pipelineTab{
	{filterAll, "ALL"},
	{filterEvaluated, "EVALUATED"},
	{filterScheduled, "SCHEDULED"},
	{filterApplied, "APPLIED"},
	{filterInterview, "INTERVIEW"},
	{filterTop, "TOP >=80"},
	{filterSkip, "SKIP"},
}

var sortCycle = []string{sortScore, sortDate, sortCompany, sortStatus}

var statusOptions = []string{"Evaluated", "Scheduled", "Applied", "Responded", "Interview", "Offer", "Rejected", "Discarded", "SKIP"}

var toolActions = []PipelineToolAction{
	{ID: "health", Label: "Health check", Description: "Run full Leagle Job validation."},
	{ID: "search_pt_preview", Label: "Search PT preview", Description: "Find new Portugal-first jobs without writing."},
	{ID: "search_pt_write", Label: "Search PT + write 5", Description: "Find new jobs and add up to 5 selected jobs to dashboard.", Writes: true},
	{ID: "deep_preview", Label: "Deep search preview", Description: "Run the broader Portugal-first scan without writing."},
	{ID: "remote_preview", Label: "Remote/EU preview", Description: "Search remote and Europe sources without writing."},
	{ID: "source_audit_preview", Label: "Source audit preview", Description: "Check a sample of source health without replacing files."},
	{ID: "source_cleanup", Label: "Source cleanup plan", Description: "Write a safe dead/blocked/fetch-failed cleanup report.", Writes: true},
	{ID: "top10_action", Label: "Top 10 action mode", Description: "Build packs and one execution checklist for the strongest jobs.", Writes: true},
	{ID: "cv_diff_top10", Label: "CV diff top 10", Description: "Create safe CV tailoring diffs for strongest jobs.", Writes: true},
	{ID: "draft_quality", Label: "Draft quality gate", Description: "Validate generated application-pack email drafts."},
	{ID: "followups", Label: "Follow-ups due", Description: "List due follow-ups and open next actions."},
	{ID: "followups_init", Label: "Init follow-ups", Description: "Create missing follow-up rows for active applications.", Writes: true},
}

// statusGroupOrder defines display order for grouped view.
var statusGroupOrder = []string{"interview", "offer", "responded", "applied", "scheduled", "evaluated", "skip", "rejected", "discarded"}

// PipelineModel implements the career pipeline dashboard screen.
type PipelineModel struct {
	apps          []model.CareerApplication
	filtered      []model.CareerApplication
	metrics       model.PipelineMetrics
	cursor        int
	scrollOffset  int
	sortMode      string
	activeTab     int
	viewMode      string // "grouped" or "flat"
	width, height int
	theme         theme.Theme
	careerOpsPath string
	reportCache   map[string]reportSummary
	// Status picker sub-state
	statusPicker bool
	statusCursor int
	// Tool action sub-state
	actionPicker  bool
	actionCursor  int
	actionConfirm bool
	actionRunning bool
	actionMessage string
	actionOutput  string
}

// NewPipelineModel creates a new pipeline screen.
func NewPipelineModel(t theme.Theme, apps []model.CareerApplication, metrics model.PipelineMetrics, careerOpsPath string, width, height int) PipelineModel {
	m := PipelineModel{
		apps:          apps,
		metrics:       metrics,
		sortMode:      sortScore,
		activeTab:     0,
		viewMode:      "grouped",
		width:         width,
		height:        height,
		theme:         t,
		careerOpsPath: careerOpsPath,
		reportCache:   make(map[string]reportSummary),
	}
	m.applyFilterAndSort()
	return m
}

// Init implements tea.Model.
func (m PipelineModel) Init() tea.Cmd {
	return m.loadCurrentReport()
}

// Resize updates dimensions.
func (m *PipelineModel) Resize(width, height int) {
	m.width = width
	m.height = height
}

// Width returns the current width.
func (m PipelineModel) Width() int { return m.width }

// Height returns the current height.
func (m PipelineModel) Height() int { return m.height }

// CopyReportCache copies the report cache from another pipeline model.
func (m *PipelineModel) CopyReportCache(other *PipelineModel) {
	for k, v := range other.reportCache {
		m.reportCache[k] = v
	}
}

// EnrichReport caches report summary data for preview.
func (m *PipelineModel) EnrichReport(reportPath, archetype, tldr, remote, comp string) {
	m.reportCache[reportPath] = reportSummary{
		archetype: archetype,
		tldr:      tldr,
		remote:    remote,
		comp:      comp,
	}
}

// SetActionRunning marks a tool action as running in the dashboard preview.
func (m *PipelineModel) SetActionRunning(action PipelineToolAction) {
	m.actionRunning = true
	m.actionMessage = "Running: " + action.Label
	m.actionOutput = ""
}

// ReplaceData refreshes the applications and metrics while preserving the
// current tab, sort mode, view mode and selection when possible.
func (m *PipelineModel) ReplaceData(apps []model.CareerApplication, metrics model.PipelineMetrics) {
	currentReport := ""
	if app, ok := m.CurrentApp(); ok {
		currentReport = app.ReportPath
	}

	m.apps = apps
	m.metrics = metrics
	m.applyFilterAndSort()

	if currentReport != "" {
		for i, app := range m.filtered {
			if app.ReportPath == currentReport {
				m.cursor = i
				m.adjustScroll()
				return
			}
		}
	}

	if m.cursor >= len(m.filtered) {
		m.cursor = len(m.filtered) - 1
	}
	if m.cursor < 0 {
		m.cursor = 0
	}
	m.adjustScroll()
}

// CurrentApp returns the currently selected application, if any.
func (m PipelineModel) CurrentApp() (model.CareerApplication, bool) {
	if m.cursor < 0 || m.cursor >= len(m.filtered) {
		return model.CareerApplication{}, false
	}
	return m.filtered[m.cursor], true
}

// Update handles input for the pipeline screen.
func (m PipelineModel) Update(msg tea.Msg) (PipelineModel, tea.Cmd) {
	switch msg := msg.(type) {
	case PipelineActionFinishedMsg:
		m.actionRunning = false
		if msg.Blocked {
			m.actionMessage = "BLOQUEADO: " + msg.Action.Label
		} else if msg.Succeeded {
			m.actionMessage = "OK: " + msg.Action.Label
		} else {
			m.actionMessage = "FAILED: " + msg.Action.Label
		}
		m.actionOutput = msg.Output
		return m, nil
	case tea.KeyMsg:
		if m.actionPicker {
			return m.handleActionPicker(msg)
		}
		if m.statusPicker {
			return m.handleStatusPicker(msg)
		}
		return m.handleKey(msg)
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	}
	return m, nil
}

func (m PipelineModel) handleKey(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "q", "esc":
		return m, func() tea.Msg { return PipelineClosedMsg{} }

	case "down":
		if len(m.filtered) > 0 {
			m.cursor++
			if m.cursor >= len(m.filtered) {
				m.cursor = len(m.filtered) - 1
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "up":
		if len(m.filtered) > 0 {
			m.cursor--
			if m.cursor < 0 {
				m.cursor = 0
			}
			m.adjustScroll()
			return m, m.loadCurrentReport()
		}

	case "s":
		// Cycle sort mode
		for i, s := range sortCycle {
			if s == m.sortMode {
				m.sortMode = sortCycle[(i+1)%len(sortCycle)]
				break
			}
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "f", "right":
		m.activeTab++
		if m.activeTab >= len(pipelineTabs) {
			m.activeTab = 0
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "left":
		m.activeTab--
		if m.activeTab < 0 {
			m.activeTab = len(pipelineTabs) - 1
		}
		m.applyFilterAndSort()
		m.cursor = 0
		m.scrollOffset = 0

	case "v":
		if m.viewMode == "grouped" {
			m.viewMode = "flat"
		} else {
			m.viewMode = "grouped"
		}

	case "enter":
		if app, ok := m.CurrentApp(); ok && app.ReportPath != "" {
			fullPath := filepath.Join(m.careerOpsPath, app.ReportPath)
			title := fmt.Sprintf("%s - %s", app.Company, app.Role)
			jobURL := app.JobURL
			return m, func() tea.Msg {
				return PipelineOpenReportMsg{Path: fullPath, Title: title, JobURL: jobURL}
			}
		}

	case "o":
		if app, ok := m.CurrentApp(); ok && app.JobURL != "" {
			return m, func() tea.Msg {
				return PipelineOpenURLMsg{URL: app.JobURL}
			}
		}

	case "d":
		if m.actionRunning {
			m.actionMessage = "Já existe uma ação em execução"
			return m, nil
		}
		if app, ok := m.CurrentApp(); ok {
			if strings.ToLower(strings.TrimSpace(app.ApplyChannel)) != "email" {
				m.actionMessage = "Esta vaga não usa candidatura por email"
				m.actionOutput = applicationBlockReason(app)
				return m, nil
			}
			if !strings.Contains(app.ApplyRecipient, "@") || isBlockedApplyStatus(app.ApplyStatus) {
				m.actionMessage = "Rascunho bloqueado"
				m.actionOutput = applicationBlockReason(app)
				return m, nil
			}
			action := PipelineToolAction{
				ID:            "create_draft",
				Label:         "Criar rascunho no Gmail",
				Description:   "Verificar a vaga, rever o email, anexar o CV certo e criar um rascunho Gmail nao enviado.",
				Writes:        true,
				ApplicationID: app.Number,
			}
			m.actionRunning = true
			m.actionMessage = "A validar e criar rascunho no Gmail..."
			m.actionOutput = ""
			return m, func() tea.Msg {
				return PipelineRunActionMsg{Action: action}
			}
		}

	case "p":
		if m.actionRunning {
			m.actionMessage = "Já existe uma ação em execução"
			return m, nil
		}
		if app, ok := m.CurrentApp(); ok {
			if !isPortalApplyChannel(app.ApplyChannel) {
				m.actionMessage = "Esta vaga não usa portal ou formulário"
				m.actionOutput = applicationBlockReason(app)
				return m, nil
			}
			if isBlockedApplyStatus(app.ApplyStatus) {
				m.actionMessage = "Candidatura bloqueada"
				m.actionOutput = applicationBlockReason(app)
				return m, nil
			}
			action := PipelineToolAction{
				ID:            "prepare_application",
				Label:         "Preparar candidatura no portal",
				Description:   "Verificar a vaga, preencher apenas dados confirmados, indicar o CV certo e parar antes do anexo/submissão humanos.",
				Writes:        true,
				ApplicationID: app.Number,
			}
			m.actionRunning = true
			m.actionMessage = "A validar e preparar a candidatura..."
			m.actionOutput = ""
			return m, func() tea.Msg {
				return PipelineRunActionMsg{Action: action}
			}
		}

	case "c":
		if len(m.filtered) > 0 {
			m.statusPicker = true
			m.statusCursor = 0
		}

	case "a":
		if m.actionRunning {
			m.actionMessage = "Action already running"
			return m, nil
		}
		m.actionPicker = true
		m.actionCursor = 0
		m.actionConfirm = false

	case "pgdown", "ctrl+d":
		m.scrollOffset += m.height / 2
		return m, nil

	case "pgup", "ctrl+u":
		m.scrollOffset -= m.height / 2
		if m.scrollOffset < 0 {
			m.scrollOffset = 0
		}
		return m, nil
	}

	return m, nil
}

func (m PipelineModel) handleActionPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.actionPicker = false
		m.actionConfirm = false
		return m, nil

	case "down":
		m.actionCursor++
		if m.actionCursor >= len(toolActions) {
			m.actionCursor = len(toolActions) - 1
		}
		m.actionConfirm = false

	case "up":
		m.actionCursor--
		if m.actionCursor < 0 {
			m.actionCursor = 0
		}
		m.actionConfirm = false

	case "enter":
		if m.actionCursor < 0 || m.actionCursor >= len(toolActions) {
			return m, nil
		}
		action := toolActions[m.actionCursor]
		if action.Writes && !m.actionConfirm {
			m.actionConfirm = true
			return m, nil
		}
		m.actionPicker = false
		m.actionConfirm = false
		m.actionRunning = true
		m.actionMessage = "Running: " + action.Label
		m.actionOutput = ""
		return m, func() tea.Msg {
			return PipelineRunActionMsg{Action: action}
		}
	}
	return m, nil
}

func (m PipelineModel) handleStatusPicker(msg tea.KeyMsg) (PipelineModel, tea.Cmd) {
	switch msg.String() {
	case "esc", "q":
		m.statusPicker = false
		return m, nil

	case "down":
		m.statusCursor++
		if m.statusCursor >= len(statusOptions) {
			m.statusCursor = len(statusOptions) - 1
		}

	case "up":
		m.statusCursor--
		if m.statusCursor < 0 {
			m.statusCursor = 0
		}

	case "enter":
		m.statusPicker = false
		if app, ok := m.CurrentApp(); ok {
			newStatus := statusOptions[m.statusCursor]
			return m, func() tea.Msg {
				return PipelineUpdateStatusMsg{
					CareerOpsPath: m.careerOpsPath,
					App:           app,
					NewStatus:     newStatus,
				}
			}
		}
	}
	return m, nil
}

func (m PipelineModel) loadCurrentReport() tea.Cmd {
	app, ok := m.CurrentApp()
	if !ok || app.ReportPath == "" {
		return nil
	}
	if _, cached := m.reportCache[app.ReportPath]; cached {
		return nil
	}
	path := m.careerOpsPath
	report := app.ReportPath
	return func() tea.Msg {
		return PipelineLoadReportMsg{CareerOpsPath: path, ReportPath: report}
	}
}

// applyFilterAndSort rebuilds the filtered list from apps.
func (m *PipelineModel) applyFilterAndSort() {
	var filtered []model.CareerApplication

	currentFilter := pipelineTabs[m.activeTab].filter
	for _, app := range m.apps {
		norm := data.NormalizeStatus(app.Status)
		switch currentFilter {
		case filterAll:
			filtered = append(filtered, app)
		case filterTop:
			if app.Score >= 80 && norm != "skip" {
				filtered = append(filtered, app)
			}
		default:
			if norm == currentFilter {
				filtered = append(filtered, app)
			}
		}
	}

	// Sort
	switch m.sortMode {
	case sortScore:
		sort.SliceStable(filtered, func(i, j int) bool {
			return filtered[i].Score > filtered[j].Score
		})
	case sortDate:
		sort.SliceStable(filtered, func(i, j int) bool {
			return filtered[i].Date > filtered[j].Date
		})
	case sortCompany:
		sort.SliceStable(filtered, func(i, j int) bool {
			return strings.ToLower(filtered[i].Company) < strings.ToLower(filtered[j].Company)
		})
	case sortStatus:
		sort.SliceStable(filtered, func(i, j int) bool {
			return data.StatusPriority(filtered[i].Status) < data.StatusPriority(filtered[j].Status)
		})
	}

	// In grouped mode, always sort by status priority first, then by selected sort within groups
	if m.viewMode == "grouped" {
		sort.SliceStable(filtered, func(i, j int) bool {
			pi := data.StatusPriority(filtered[i].Status)
			pj := data.StatusPriority(filtered[j].Status)
			if pi != pj {
				return pi < pj
			}
			// Within same group, use selected sort
			switch m.sortMode {
			case sortScore:
				return filtered[i].Score > filtered[j].Score
			case sortDate:
				return filtered[i].Date > filtered[j].Date
			case sortCompany:
				return strings.ToLower(filtered[i].Company) < strings.ToLower(filtered[j].Company)
			default:
				return filtered[i].Score > filtered[j].Score
			}
		})
	}

	m.filtered = filtered
}

// adjustScroll updates scrollOffset so the cursor stays visible.
func (m *PipelineModel) adjustScroll() {
	availHeight := m.height - 12 // header + tabs(2) + metrics + sortbar + footer + preview
	if availHeight < 5 {
		availHeight = 5
	}
	line := m.cursorLineEstimate()
	margin := 3

	if line >= m.scrollOffset+availHeight-margin {
		m.scrollOffset = line - availHeight + margin + 1
	}
	if line < m.scrollOffset+margin {
		m.scrollOffset = line - margin
	}
	if m.scrollOffset < 0 {
		m.scrollOffset = 0
	}
}

func (m PipelineModel) cursorLineEstimate() int {
	if m.viewMode != "grouped" {
		return m.cursor
	}
	// Account for group headers
	line := 0
	prevStatus := ""
	for i, app := range m.filtered {
		norm := data.NormalizeStatus(app.Status)
		if norm != prevStatus {
			line++ // group header
			prevStatus = norm
		}
		if i == m.cursor {
			return line
		}
		line++
	}
	return line
}

// -- View --

// View renders the pipeline screen.
func (m PipelineModel) View() string {
	header := m.renderHeader()
	tabs := m.renderTabs()
	metricsBar := m.renderMetrics()
	sortBar := m.renderSortBar()
	body := m.renderBody()
	preview := m.renderPreview()
	help := m.renderHelp()

	// Apply scroll to body
	bodyLines := strings.Split(body, "\n")
	if m.scrollOffset > 0 && m.scrollOffset < len(bodyLines) {
		bodyLines = bodyLines[m.scrollOffset:]
	}

	// Calculate available height for body
	previewLines := strings.Count(preview, "\n") + 1
	availHeight := m.height - 7 - previewLines // header + tabs(2) + metrics + sortbar + help + preview
	if availHeight < 3 {
		availHeight = 3
	}
	if len(bodyLines) > availHeight {
		bodyLines = bodyLines[:availHeight]
	}
	body = strings.Join(bodyLines, "\n")

	// Picker overlays
	if m.actionPicker {
		body = m.overlayActionPicker(body)
	} else if m.statusPicker {
		body = m.overlayStatusPicker(body)
	}

	return lipgloss.JoinVertical(lipgloss.Left,
		header,
		tabs,
		metricsBar,
		sortBar,
		body,
		preview,
		help,
	)
}

func (m PipelineModel) renderHeader() string {
	style := lipgloss.NewStyle().
		Bold(true).
		Foreground(m.theme.Text).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	right := lipgloss.NewStyle().Foreground(m.theme.Subtext)
	avg := fmt.Sprintf("%.0f", m.metrics.AvgScore)
	info := right.Render(fmt.Sprintf("%d offers | Avg %s/100", m.metrics.Total, avg))

	title := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Blue).Render("CAREER PIPELINE")
	gap := m.width - lipgloss.Width(title) - lipgloss.Width(info) - 4
	if gap < 1 {
		gap = 1
	}

	return style.Render(title + strings.Repeat(" ", gap) + info)
}

func (m PipelineModel) renderTabs() string {
	var tabs []string
	var underParts []string

	for i, tab := range pipelineTabs {
		// Count items for this tab
		count := m.countForFilter(tab.filter)
		label := fmt.Sprintf(" %s (%d) ", tab.label, count)

		if i == m.activeTab {
			style := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Blue).
				Padding(0, 0)
			tabs = append(tabs, style.Render(label))
			underParts = append(underParts, strings.Repeat("=", lipgloss.Width(label)))
		} else {
			style := lipgloss.NewStyle().
				Foreground(m.theme.Subtext).
				Padding(0, 0)
			tabs = append(tabs, style.Render(label))
			underParts = append(underParts, strings.Repeat("-", lipgloss.Width(label)))
		}
	}

	row := lipgloss.JoinHorizontal(lipgloss.Top, tabs...)
	underline := lipgloss.NewStyle().Foreground(m.theme.Overlay).Render(strings.Join(underParts, ""))

	padStyle := lipgloss.NewStyle().Padding(0, 1)
	return padStyle.Render(row) + "\n" + padStyle.Render(underline)
}

func (m PipelineModel) countForFilter(filter string) int {
	count := 0
	for _, app := range m.apps {
		norm := data.NormalizeStatus(app.Status)
		switch filter {
		case filterAll:
			count++
		case filterTop:
			if app.Score >= 80 && norm != "skip" {
				count++
			}
		default:
			if norm == filter {
				count++
			}
		}
	}
	return count
}

func (m PipelineModel) renderMetrics() string {
	style := lipgloss.NewStyle().
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 2)

	var parts []string
	statusColors := m.statusColorMap()

	for _, status := range statusGroupOrder {
		count, ok := m.metrics.ByStatus[status]
		if !ok || count == 0 {
			continue
		}
		color := statusColors[status]
		s := lipgloss.NewStyle().Foreground(color)
		parts = append(parts, s.Render(fmt.Sprintf("%s:%d", statusLabel(status), count)))
	}
	if m.metrics.FollowupDue > 0 {
		parts = append(parts, lipgloss.NewStyle().Foreground(m.theme.Yellow).Bold(true).Render(fmt.Sprintf("Follow-up due:%d", m.metrics.FollowupDue)))
	}
	if m.metrics.NeedsAction > 0 {
		parts = append(parts, lipgloss.NewStyle().Foreground(m.theme.Sky).Render(fmt.Sprintf("Next actions:%d", m.metrics.NeedsAction)))
	}

	return style.Render(strings.Join(parts, "  "))
}

func (m PipelineModel) renderSortBar() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Width(m.width).
		Padding(0, 2)

	count := fmt.Sprintf("%d vagas · ordenadas por relevância", len(m.filtered))
	toolLabel := ""
	if m.actionRunning {
		toolLabel = "  ·  a processar..."
	} else if m.actionMessage != "" {
		toolLabel = "  ·  " + ellipsize(m.actionMessage, 52)
	}

	return style.Render(count + toolLabel)
}

func (m PipelineModel) renderBody() string {
	if len(m.filtered) == 0 {
		emptyStyle := lipgloss.NewStyle().
			Foreground(m.theme.Subtext).
			Padding(1, 2)
		return emptyStyle.Render("No offers match this filter")
	}

	var lines []string
	prevStatus := ""
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	for i, app := range m.filtered {
		norm := data.NormalizeStatus(app.Status)

		// Group header in grouped mode
		if m.viewMode == "grouped" && norm != prevStatus {
			count := m.countByNormStatus(norm)
			headerStyle := lipgloss.NewStyle().
				Bold(true).
				Foreground(m.theme.Subtext)
			lines = append(lines, padStyle.Render(
				headerStyle.Render(fmt.Sprintf("-- %s (%d) %s",
					strings.ToUpper(statusLabel(norm)), count,
					strings.Repeat("-", max(0, m.width-30-len(statusLabel(norm)))))),
			))
			prevStatus = norm
		}

		selected := i == m.cursor
		line := m.renderAppLine(app, selected)
		lines = append(lines, line)
	}

	return strings.Join(lines, "\n")
}

func (m PipelineModel) renderAppLine(app model.CareerApplication, selected bool) string {
	padStyle := lipgloss.NewStyle().Padding(0, 2)

	// Column widths
	scoreW := 6 // "100  "
	companyW := 20
	statusW := 12
	sideW := 28
	// Role gets remaining space
	roleW := m.width - scoreW - companyW - statusW - sideW - 10
	if roleW < 15 {
		roleW = 15
	}
	if m.width < 120 {
		sideW = 20
		roleW = m.width - scoreW - companyW - statusW - sideW - 10
		if roleW < 15 {
			roleW = 15
		}
	}

	// Score with color
	scoreStyle := m.scoreStyle(app.Score)
	score := scoreStyle.Render(fmt.Sprintf("%.0f", app.Score))

	// Company (display-width safe)
	company := ellipsize(app.Company, companyW)
	companyStyle := lipgloss.NewStyle().Foreground(m.theme.Text).Width(companyW)

	// Role (display-width safe)
	role := ellipsize(app.Role, roleW)
	roleStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext).Width(roleW)

	// Status with color -- fixed column
	norm := data.NormalizeStatus(app.Status)
	statusColor := m.statusColorMap()[norm]
	statusStyle := lipgloss.NewStyle().Foreground(statusColor).Width(statusW)
	statusText := statusStyle.Render(statusLabel(norm))

	// Right-side hint: prefer compensation from report; fall back to tracker notes.
	sideText := m.rightHint(app, sideW)
	sideStyle := lipgloss.NewStyle().Foreground(m.theme.Yellow).Width(sideW)

	line := fmt.Sprintf(" %s %s %s %s %s",
		score,
		companyStyle.Render(company),
		roleStyle.Render(role),
		statusText,
		sideStyle.Render(sideText),
	)

	if selected {
		selStyle := lipgloss.NewStyle().
			Background(m.theme.Overlay).
			Width(m.width - 4)
		return padStyle.Render(selStyle.Render(line))
	}
	return padStyle.Render(line)
}

func (m PipelineModel) renderPreview() string {
	app, ok := m.CurrentApp()
	if !ok {
		return ""
	}

	padStyle := lipgloss.NewStyle().Padding(0, 2)
	divider := lipgloss.NewStyle().Foreground(m.theme.Overlay)

	var lines []string
	lines = append(lines, padStyle.Render(divider.Render(strings.Repeat("-", m.width-4))))

	labelStyle := lipgloss.NewStyle().Foreground(m.theme.Sky).Bold(true)
	valueStyle := lipgloss.NewStyle().Foreground(m.theme.Text)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	contentW := m.width - 4
	if contentW < 20 {
		contentW = 20
	}

	// Check report cache
	if summary, ok := m.reportCache[app.ReportPath]; ok {
		if summary.archetype != "" {
			lines = append(lines, m.previewRows(padStyle, labelStyle, valueStyle, "Arquetipo", summary.archetype, contentW)...)
		}
		if summary.tldr != "" {
			lines = append(lines, m.previewRows(padStyle, labelStyle, valueStyle, "TL;DR", summary.tldr, contentW)...)
		}
		if summary.comp != "" {
			lines = append(lines, m.previewRows(padStyle, labelStyle, valueStyle, "Comp", summary.comp, contentW)...)
		}
		if summary.remote != "" {
			lines = append(lines, m.previewRows(padStyle, labelStyle, valueStyle, "Remote", summary.remote, contentW)...)
		}
		if app.Notes != "" {
			lines = append(lines, m.previewRows(padStyle, labelStyle, dimStyle, "Nota", app.Notes, contentW)...)
		}
	} else if app.Notes != "" {
		// Fallback: show notes
		for _, row := range wrapText(app.Notes, contentW) {
			lines = append(lines, padStyle.Render(dimStyle.Render(row)))
		}
	} else {
		lines = append(lines, padStyle.Render(dimStyle.Render("Loading preview...")))
	}
	if app.FollowupDue != "" {
		lines = append(lines, m.previewRows(padStyle, labelStyle, valueStyle, "Follow-up", app.FollowupDue, contentW)...)
	}
	if app.AppliedAt != "" {
		lines = append(lines, m.previewRows(padStyle, labelStyle, dimStyle, "Applied", app.AppliedAt, contentW)...)
	}
	if app.LastContact != "" {
		lines = append(lines, m.previewRows(padStyle, labelStyle, dimStyle, "Last", app.LastContact, contentW)...)
	}
	if app.NextAction != "" {
		lines = append(lines, m.previewRows(padStyle, labelStyle, valueStyle, "Next", app.NextAction, contentW)...)
	}
	if app.ApplyChannel != "" {
		lines = append(lines, m.previewRows(padStyle, labelStyle, valueStyle, "Candidatura", applicationMethodLabel(app), contentW)...)
	}
	if app.ApplyBlocker != "" && app.ApplyBlocker != "sem blocker operacional obvio; rever pack antes de aplicar" {
		lines = append(lines, m.previewRows(padStyle, labelStyle, dimStyle, "Bloqueio", app.ApplyBlocker, contentW)...)
	}
	if app.FollowupNotes != "" {
		lines = append(lines, m.previewRows(padStyle, labelStyle, dimStyle, "Follow-up notes", app.FollowupNotes, contentW)...)
	}

	button, description, enabled := applicationButton(app)
	buttonStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Base).Background(m.theme.Green).Padding(0, 2)
	if !enabled || m.actionRunning {
		buttonStyle = buttonStyle.Foreground(m.theme.Subtext).Background(m.theme.Overlay)
	}
	if m.actionRunning {
		button = "[ ... ] A PROCESSAR"
	}
	lines = append(lines, padStyle.Render(buttonStyle.Render(button)), padStyle.Render(dimStyle.Render(description)))

	if m.actionMessage != "" || m.actionOutput != "" {
		lines = append(lines, padStyle.Render(divider.Render(strings.Repeat("-", m.width-4))))
		if m.actionMessage != "" {
			lines = append(lines, m.previewRows(padStyle, labelStyle, valueStyle, "Tool", m.actionMessage, contentW)...)
		}
		if m.actionOutput != "" {
			lines = append(lines, m.previewRows(padStyle, labelStyle, dimStyle, "Output", m.actionOutput, contentW)...)
		}
	}

	return strings.Join(lines, "\n")
}

func (m PipelineModel) rightHint(app model.CareerApplication, width int) string {
	if width <= 0 {
		return ""
	}
	if app.FollowupDue != "" {
		return ellipsize("Follow-up "+app.FollowupDue, width)
	}
	if app.NextAction != "" && data.NormalizeStatus(app.Status) != "evaluated" {
		return ellipsize(app.NextAction, width)
	}
	if summary, ok := m.reportCache[app.ReportPath]; ok && summary.comp != "" && !strings.EqualFold(summary.comp, "a confirmar") {
		return ellipsize(summary.comp, width)
	}
	if app.Notes != "" {
		return ellipsize(app.Notes, width)
	}
	return ""
}

func (m PipelineModel) previewRows(pad, labelStyle, valueStyle lipgloss.Style, label, value string, width int) []string {
	prefix := label + ": "
	valueWidth := width - lipgloss.Width(prefix)
	if valueWidth < 12 {
		valueWidth = width
	}

	wrapped := wrapText(value, valueWidth)
	if len(wrapped) == 0 {
		return nil
	}

	rows := []string{
		pad.Render(labelStyle.Render(prefix) + valueStyle.Render(wrapped[0])),
	}
	indent := strings.Repeat(" ", lipgloss.Width(prefix))
	for _, row := range wrapped[1:] {
		rows = append(rows, pad.Render(valueStyle.Render(indent+row)))
	}
	return rows
}

func (m PipelineModel) renderHelp() string {
	style := lipgloss.NewStyle().
		Foreground(m.theme.Subtext).
		Background(m.theme.Surface).
		Width(m.width).
		Padding(0, 1)

	keyStyle := lipgloss.NewStyle().Bold(true).Foreground(m.theme.Text)
	descStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	if m.statusPicker {
		return style.Render(
			keyStyle.Render("up/down") + descStyle.Render(" navigate  ") +
				keyStyle.Render("Enter") + descStyle.Render(" confirm  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}
	if m.actionPicker {
		return style.Render(
			keyStyle.Render("up/down") + descStyle.Render(" actions  ") +
				keyStyle.Render("Enter") + descStyle.Render(" run/confirm  ") +
				keyStyle.Render("Esc") + descStyle.Render(" cancel"))
	}

	actionKey, actionDescription := m.currentApplicationHelp()
	keys := keyStyle.Render("↑↓") + descStyle.Render(" vagas   ") +
		keyStyle.Render("←→") + descStyle.Render(" listas   ") +
		keyStyle.Render("Enter") + descStyle.Render(" detalhes   ") +
		keyStyle.Render(actionKey) + descStyle.Render(" "+actionDescription+"   ") +
		keyStyle.Render("O") + descStyle.Render(" abrir vaga   ") +
		keyStyle.Render("C") + descStyle.Render(" estado   ") +
		keyStyle.Render("Esc") + descStyle.Render(" sair")

	return style.Render(keys)
}

func (m PipelineModel) currentApplicationHelp() (string, string) {
	app, ok := m.CurrentApp()
	if !ok {
		return "-", "sem ação"
	}
	channel := strings.ToLower(strings.TrimSpace(app.ApplyChannel))
	if channel == "email" {
		return "D", "criar draft Gmail"
	}
	if isPortalApplyChannel(channel) {
		return "P", "preparar candidatura"
	}
	return "!", "canal por confirmar"
}

func applicationButton(app model.CareerApplication) (string, string, bool) {
	channel := strings.ToLower(strings.TrimSpace(app.ApplyChannel))
	if channel == "email" {
		enabled := strings.Contains(app.ApplyRecipient, "@") && !isBlockedApplyStatus(app.ApplyStatus)
		if enabled {
			return "[ D ] CRIAR DRAFT GMAIL", "Cria um rascunho real no Gmail com o CV correto; nunca envia.", true
		}
		return "[ ! ] EMAIL BLOQUEADO", applicationBlockReason(app), false
	}
	if isPortalApplyChannel(channel) {
		if isBlockedApplyStatus(app.ApplyStatus) {
			return "[ ! ] CANDIDATURA BLOQUEADA", applicationBlockReason(app), false
		}
		return "[ P ] PREPARAR CANDIDATURA", "Preenche dados confirmados e anexa o CV; para antes de submeter.", true
	}
	return "[ ! ] CANAL POR CONFIRMAR", applicationBlockReason(app), false
}

func applicationMethodLabel(app model.CareerApplication) string {
	channel := strings.TrimSpace(app.ApplyChannel)
	status := strings.TrimSpace(app.ApplyStatus)
	if channel == "" {
		return "a confirmar"
	}
	if status == "" {
		return channel
	}
	return channel + " / " + status
}

func applicationBlockReason(app model.CareerApplication) string {
	if strings.TrimSpace(app.ApplyBlocker) != "" {
		return app.ApplyBlocker
	}
	if strings.TrimSpace(app.ApplyNext) != "" {
		return app.ApplyNext
	}
	return "Método de candidatura ou dados obrigatórios ainda não confirmados."
}

func isPortalApplyChannel(channel string) bool {
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case "official_portal", "linkedin_apply", "job_board_apply", "manual_apply_url":
		return true
	default:
		return false
	}
}

func isBlockedApplyStatus(status string) bool {
	value := strings.ToLower(strings.TrimSpace(status))
	return value == "" || strings.HasPrefix(value, "blocked_") || strings.HasPrefix(value, "needs_")
}

func (m PipelineModel) overlayActionPicker(body string) string {
	bodyLines := strings.Split(body, "\n")

	pickerWidth := min(max(56, m.width-8), 100)
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)
	warnStyle := lipgloss.NewStyle().Foreground(m.theme.Yellow)
	dimStyle := lipgloss.NewStyle().Foreground(m.theme.Subtext)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render("Leagle Job actions")))
	for i, action := range toolActions {
		prefix := "  "
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.actionCursor {
			prefix = "> "
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		writeTag := ""
		if action.Writes {
			writeTag = " [writes]"
		}
		label := fmt.Sprintf("%s%s%s - %s", prefix, action.Label, writeTag, action.Description)
		picker = append(picker, padStyle.Render(style.Render(ellipsize(label, pickerWidth))))
	}
	if m.actionConfirm {
		picker = append(picker, padStyle.Render(warnStyle.Render("This action writes files. Press Enter again to run.")))
	} else {
		picker = append(picker, padStyle.Render(dimStyle.Render("Preview actions do not write dashboard entries.")))
	}

	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

func (m PipelineModel) overlayStatusPicker(body string) string {
	// Render status picker inline at bottom of body
	bodyLines := strings.Split(body, "\n")

	pickerWidth := 30
	padStyle := lipgloss.NewStyle().Padding(0, 2)
	borderStyle := lipgloss.NewStyle().
		Foreground(m.theme.Blue).
		Bold(true)

	var picker []string
	picker = append(picker, padStyle.Render(borderStyle.Render("Change status:")))

	for i, opt := range statusOptions {
		style := lipgloss.NewStyle().Foreground(m.theme.Text).Width(pickerWidth)
		if i == m.statusCursor {
			style = style.Background(m.theme.Overlay).Bold(true)
		}
		prefix := "  "
		if i == m.statusCursor {
			prefix = "> "
		}
		picker = append(picker, padStyle.Render(style.Render(prefix+opt)))
	}

	// Append picker to body
	bodyLines = append(bodyLines, picker...)
	return strings.Join(bodyLines, "\n")
}

// -- Helpers --

func (m PipelineModel) scoreStyle(score float64) lipgloss.Style {
	switch {
	case score >= 84:
		return lipgloss.NewStyle().Foreground(m.theme.Green).Bold(true)
	case score >= 76:
		return lipgloss.NewStyle().Foreground(m.theme.Yellow)
	case score >= 60:
		return lipgloss.NewStyle().Foreground(m.theme.Text)
	default:
		return lipgloss.NewStyle().Foreground(m.theme.Red)
	}
}

func (m PipelineModel) statusColorMap() map[string]lipgloss.Color {
	return map[string]lipgloss.Color{
		"interview": m.theme.Green,
		"offer":     m.theme.Green,
		"applied":   m.theme.Sky,
		"scheduled": m.theme.Yellow,
		"responded": m.theme.Blue,
		"evaluated": m.theme.Text,
		"skip":      m.theme.Red,
		"rejected":  m.theme.Subtext,
		"discarded": m.theme.Subtext,
	}
}

func (m PipelineModel) countByNormStatus(status string) int {
	count := 0
	for _, app := range m.filtered {
		if data.NormalizeStatus(app.Status) == status {
			count++
		}
	}
	return count
}

func statusLabel(norm string) string {
	switch norm {
	case "interview":
		return "Interview"
	case "offer":
		return "Offer"
	case "responded":
		return "Responded"
	case "applied":
		return "Applied"
	case "scheduled":
		return "Scheduled"
	case "evaluated":
		return "Evaluated"
	case "skip":
		return "Skip"
	case "rejected":
		return "Rejected"
	case "discarded":
		return "Discarded"
	default:
		return norm
	}
}

func ellipsize(text string, width int) string {
	text = strings.TrimSpace(text)
	if width <= 0 || text == "" {
		return ""
	}
	if lipgloss.Width(text) <= width {
		return text
	}
	if width <= 3 {
		return strings.Repeat(".", width)
	}

	runes := []rune(text)
	out := ""
	for _, r := range runes {
		next := out + string(r)
		if lipgloss.Width(next)+3 > width {
			break
		}
		out = next
	}
	return strings.TrimSpace(out) + "..."
}

func wrapText(text string, width int) []string {
	text = strings.TrimSpace(strings.Join(strings.Fields(text), " "))
	if text == "" {
		return nil
	}
	if width <= 1 {
		return splitLongWord(text, 1)
	}

	words := strings.Fields(text)
	lines := make([]string, 0)
	current := ""

	for _, word := range words {
		for _, chunk := range splitLongWord(word, width) {
			if current == "" {
				current = chunk
				continue
			}
			candidate := current + " " + chunk
			if lipgloss.Width(candidate) <= width {
				current = candidate
				continue
			}
			lines = append(lines, current)
			current = chunk
		}
	}

	if current != "" {
		lines = append(lines, current)
	}
	return lines
}

func splitLongWord(word string, width int) []string {
	if word == "" {
		return nil
	}
	if width <= 0 || lipgloss.Width(word) <= width {
		return []string{word}
	}

	chunks := make([]string, 0)
	current := ""
	for _, r := range word {
		next := current + string(r)
		if current != "" && lipgloss.Width(next) > width {
			chunks = append(chunks, current)
			current = string(r)
			continue
		}
		current = next
	}
	if current != "" {
		chunks = append(chunks, current)
	}
	return chunks
}
