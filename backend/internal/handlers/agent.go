package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/agent"
	"github.com/vetkb/backend/internal/services"
)

type AgentHandler struct {
	agentService *agent.AgentService
	chatService  *services.ChatService
}

func NewAgentHandler(agentService *agent.AgentService, chatService *services.ChatService) *AgentHandler {
	return &AgentHandler{
		agentService: agentService,
		chatService:  chatService,
	}
}

type chatRequest struct {
	Message   string `json:"message" binding:"required"`
	SessionID uint   `json:"session_id"`
}

// Chat handles SSE streaming chat endpoint.
func (h *AgentHandler) Chat(c *gin.Context) {
	var req chatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message is required"})
		return
	}

	userID, _ := c.Get("userID")
	companyID := getCompanyID(c)

	sessionID := req.SessionID

	// Create new session if needed
	if sessionID == 0 {
		// Generate title from first ~50 chars of message
		title := req.Message
		if len([]rune(title)) > 50 {
			title = string([]rune(title)[:50]) + "..."
		}
		session, err := h.chatService.CreateSession(userID.(uint), companyID, title)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create session"})
			return
		}
		sessionID = session.ID
	} else {
		// Verify session belongs to user
		_, err := h.chatService.GetSession(sessionID, userID.(uint))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
	}

	// Set SSE headers
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	ctx := c.Request.Context()
	flusher := c.Writer

	// Stream response
	sources, err := h.agentService.Query(ctx, req.Message, sessionID, companyID, func(text string) {
		data, _ := json.Marshal(map[string]string{"text": text})
		fmt.Fprintf(flusher, "event: token\ndata: %s\n\n", data)
		flusher.Flush()
	})

	if err != nil {
		errData, _ := json.Marshal(map[string]string{"error": err.Error()})
		fmt.Fprintf(flusher, "event: error\ndata: %s\n\n", errData)
		flusher.Flush()
		return
	}

	// Send sources
	if sources != nil {
		sourcesData, _ := json.Marshal(sources)
		fmt.Fprintf(flusher, "event: sources\ndata: %s\n\n", sourcesData)
		flusher.Flush()
	}

	// Send done
	doneData, _ := json.Marshal(map[string]uint{"session_id": sessionID})
	fmt.Fprintf(flusher, "event: done\ndata: %s\n\n", doneData)
	flusher.Flush()
}

// RAGStream handles SSE streaming RAG queries for voice agent — no auth.
func (h *AgentHandler) RAGStream(c *gin.Context) {
	var req struct {
		Text      string `json:"text" binding:"required"`
		SessionID uint   `json:"session_id"`
		CompanyID *uint  `json:"company_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "text is required"})
		return
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	ctx := c.Request.Context()
	flusher := c.Writer

	sources, err := h.agentService.Query(ctx, req.Text, req.SessionID, req.CompanyID, func(text string) {
		data, _ := json.Marshal(map[string]string{"text": text})
		fmt.Fprintf(flusher, "event: token\ndata: %s\n\n", data)
		flusher.Flush()
	})

	if err != nil {
		errData, _ := json.Marshal(map[string]string{"error": err.Error()})
		fmt.Fprintf(flusher, "event: error\ndata: %s\n\n", errData)
		flusher.Flush()
		return
	}

	if sources != nil {
		sourcesData, _ := json.Marshal(sources)
		fmt.Fprintf(flusher, "event: sources\ndata: %s\n\n", sourcesData)
		flusher.Flush()
	}

	fmt.Fprintf(flusher, "event: done\ndata: {}\n\n")
	flusher.Flush()
}

// RAG handles internal (Pipecat) RAG queries — no auth, non-streaming.
func (h *AgentHandler) RAG(c *gin.Context) {
	var req struct {
		Text      string `json:"text" binding:"required"`
		SessionID uint   `json:"session_id"`
		CompanyID *uint  `json:"company_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "text and session_id are required"})
		return
	}

	response, sources, err := h.agentService.QuerySync(c.Request.Context(), req.Text, req.SessionID, req.CompanyID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"response": response,
		"sources":  sources,
	})
}

// ListSessions returns user's chat sessions.
func (h *AgentHandler) ListSessions(c *gin.Context) {
	userID, _ := c.Get("userID")
	sessions, err := h.chatService.ListSessions(userID.(uint))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, sessions)
}

// GetMessages returns messages for a session.
func (h *AgentHandler) GetMessages(c *gin.Context) {
	userID, _ := c.Get("userID")
	sessionID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session id"})
		return
	}

	// Verify session belongs to user
	_, err = h.chatService.GetSession(uint(sessionID), userID.(uint))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}

	messages, err := h.chatService.GetMessages(uint(sessionID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, messages)
}

// DeleteSession deletes a chat session and its messages.
func (h *AgentHandler) DeleteSession(c *gin.Context) {
	userID, _ := c.Get("userID")
	sessionID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid session id"})
		return
	}

	if err := h.chatService.DeleteSession(uint(sessionID), userID.(uint)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "session deleted"})
}
