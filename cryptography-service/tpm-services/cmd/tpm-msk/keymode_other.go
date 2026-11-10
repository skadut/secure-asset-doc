//go:build !windows

package main

import (
	"errors"
	"os"
)

func keyModeEnter(*os.File) (func(), error) {
	return nil, errors.New("not a windows console")
}
