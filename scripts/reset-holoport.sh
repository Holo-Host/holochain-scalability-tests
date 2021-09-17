#! /usr/bin/env bash
# Script for reseting holochain on holoport to the blank state
# and switching to selected nix-channel
# Use with caution :-)
#
# Usage:
# ./reset-holoport.sh <hp-zt-ip-address> <holoport-channel>
#
# Requires env var SSH_KEY_PATH with path to ssh key which is registered to access holoports

set -e

ssh -o StrictHostKeychecking=no root@$1 -i $SSH_KEY_PATH bash <<EOF
  nix-channel --add https://hydra.holo.host/channel/custom/holo-nixpkgs/$2/holo-nixpkgs
  nix-channel --update
  nixos-rebuild switch

  rm -rf /tmp/trycp/
EOF
