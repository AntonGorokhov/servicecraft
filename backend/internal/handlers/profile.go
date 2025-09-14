package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/services"
)

type ProfileHandler struct {
	authService *services.AuthService
}

func NewProfileHandler(s *services.AuthService) *ProfileHandler {
	return &ProfileHandler{authService: s}
}

type updateProfileRequest struct {
	Name string `json:"name" binding:"required"`
}

func (h *ProfileHandler) UpdateProfile(c *gin.Context) {
	var req updateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	userID, _ := c.Get("userID")
	user, err := h.authService.UpdateProfile(userID.(uint), req.Name)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"id":    user.ID,
		"email": user.Email,
		"name":  user.Name,
		"role":  user.Role,
	})
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password" binding:"required"`
	NewPassword     string `json:"new_password" binding:"required,min=6"`
}

func (h *ProfileHandler) ChangePassword(c *gin.Context) {
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	userID, _ := c.Get("userID")
	if err := h.authService.ChangePassword(userID.(uint), req.CurrentPassword, req.NewPassword); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Password changed successfully"})
}
