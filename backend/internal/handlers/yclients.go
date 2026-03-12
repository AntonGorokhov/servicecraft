package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/yclients"
)

type YClientsHandler struct{}

func NewYClientsHandler() *YClientsHandler {
	return &YClientsHandler{}
}

func (h *YClientsHandler) GetSlots(c *gin.Context) {
	service := c.Query("service")
	slots := yclients.GetSlots(service)
	c.JSON(http.StatusOK, gin.H{"slots": slots, "total": len(slots)})
}

func (h *YClientsHandler) Book(c *gin.Context) {
	var input struct {
		SlotID  string `json:"slot_id" binding:"required"`
		PetName string `json:"pet_name" binding:"required"`
		Phone   string `json:"phone" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	booking, err := yclients.BookSlot(input.SlotID, input.PetName, input.Phone)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, booking)
}

func (h *YClientsHandler) GetPatient(c *gin.Context) {
	phone := c.Param("phone")
	patient, ok := yclients.GetPatient(phone)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "patient not found"})
		return
	}
	c.JSON(http.StatusOK, patient)
}
