package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/vetkb/backend/internal/services"
)

type PriceHandler struct {
	priceService *services.PriceService
}

func NewPriceHandler(priceService *services.PriceService) *PriceHandler {
	return &PriceHandler{priceService: priceService}
}

func (h *PriceHandler) GetTree(c *gin.Context) {
	c.JSON(http.StatusOK, h.priceService.GetTree())
}
