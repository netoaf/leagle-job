package model

// CareerApplication represents a single job application from the tracker.
type CareerApplication struct {
	Number         int
	Date           string
	Company        string
	Role           string
	Status         string
	Score          float64
	ScoreRaw       string
	HasPDF         bool
	ReportPath     string
	ReportNumber   string
	Notes          string
	JobURL         string // URL of the original job posting
	AppliedAt      string
	LastContact    string
	FollowupDue    string
	ContactChannel string
	ContactName    string
	NextAction     string
	FollowupNotes  string
	ApplyChannel   string
	ApplyURL       string
	ApplyRecipient string
	ApplyStatus    string
	ApplyBlocker   string
	ApplyNext      string
	// Enrichment (lazy loaded from report)
	Archetype    string
	TlDr         string
	Remote       string
	CompEstimate string
}

// PipelineMetrics holds aggregate stats for the pipeline dashboard.
type PipelineMetrics struct {
	Total       int
	ByStatus    map[string]int
	AvgScore    float64
	TopScore    float64
	WithPDF     int
	Actionable  int
	FollowupDue int
	NeedsAction int
}
