package services

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/vetkb/backend/internal/models"
	"gorm.io/gorm"
)

type AuthService struct {
	db        *gorm.DB
	jwtSecret []byte
}

type TokenPair struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

type Claims struct {
	UserID    uint   `json:"user_id"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	TokenType string `json:"token_type"`
	jwt.RegisteredClaims
}

func NewAuthService(db *gorm.DB, secret string) *AuthService {
	return &AuthService{db: db, jwtSecret: []byte(secret)}
}

func (s *AuthService) Login(email, password string) (*TokenPair, *models.User, error) {
	var user models.User
	if err := s.db.Where("email = ?", email).First(&user).Error; err != nil {
		return nil, nil, errors.New("invalid credentials")
	}
	if !user.CheckPassword(password) {
		return nil, nil, errors.New("invalid credentials")
	}

	pair, err := s.generateTokenPair(&user)
	if err != nil {
		return nil, nil, err
	}
	return pair, &user, nil
}

func (s *AuthService) RefreshToken(refreshToken string) (*TokenPair, error) {
	claims, err := s.parseToken(refreshToken)
	if err != nil {
		return nil, errors.New("invalid refresh token")
	}
	if claims.TokenType != "refresh" {
		return nil, errors.New("invalid token type")
	}

	var user models.User
	if err := s.db.First(&user, claims.UserID).Error; err != nil {
		return nil, errors.New("user not found")
	}

	return s.generateTokenPair(&user)
}

func (s *AuthService) ValidateAccessToken(tokenStr string) (*Claims, error) {
	claims, err := s.parseToken(tokenStr)
	if err != nil {
		return nil, err
	}
	if claims.TokenType != "access" {
		return nil, errors.New("invalid token type")
	}
	return claims, nil
}

func (s *AuthService) GetUserByID(id uint) (*models.User, error) {
	var user models.User
	if err := s.db.First(&user, id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *AuthService) generateTokenPair(user *models.User) (*TokenPair, error) {
	now := time.Now()

	accessClaims := Claims{
		UserID:    user.ID,
		Email:     user.Email,
		Role:      user.Role,
		TokenType: "access",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims).SignedString(s.jwtSecret)
	if err != nil {
		return nil, err
	}

	refreshClaims := Claims{
		UserID:    user.ID,
		Email:     user.Email,
		Role:      user.Role,
		TokenType: "refresh",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	refreshToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims).SignedString(s.jwtSecret)
	if err != nil {
		return nil, err
	}

	return &TokenPair{AccessToken: accessToken, RefreshToken: refreshToken}, nil
}

func (s *AuthService) parseToken(tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		return s.jwtSecret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
