#!/usr/bin/env bash
set -e
sudo systemctl daemon-reload
sudo systemctl restart shadow-reducer || true
sudo systemctl restart shadow-backend || true
