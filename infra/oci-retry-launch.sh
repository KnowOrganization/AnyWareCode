#!/usr/bin/env bash
# Retry-launch the A1.Flex instance until OCI frees free-tier ARM capacity.
# ponytail: plain poll loop, no fancy backoff — capacity is binary, 60s is fine.
set -u

export OCI_CLI_PROFILE=mumbai
export OCI_CLI_AUTH=security_token

TENANCY=ocid1.tenancy.oc1..aaaaaaaabre3wltx3iyvs5bvilap3timvhsl6nlv4pzq7q5nqow3cvzeyiea
AD="DXaK:AP-MUMBAI-1-AD-1"
SUBNET=ocid1.subnet.oc1.ap-mumbai-1.aaaaaaaany4hrn2wi55hpihn6al22t4svvwjag43khoxfzkqklx23uftccaq
IMAGE=ocid1.image.oc1.ap-mumbai-1.aaaaaaaa2op2x2s5rnduo5osx6zojr526qxtrvhddkdhks5nllbwjzcylwya
SSH_PUB="$HOME/Downloads/ssh-key-2026-06-20.key.pub"

# Free-tier A1 ceiling: 4 OCPU / 24GB. Lower these if you want capacity to land sooner.
OCPUS=4
MEM_GB=24
BOOT_GB=100
NAME=AnyWareCode

i=0
while true; do
  i=$((i+1))
  ts=$(date '+%H:%M:%S')
  # Keep the session token alive (it expires ~1h; refresh is a no-op if still fresh).
  oci session refresh --profile mumbai >/dev/null 2>&1

  out=$(oci compute instance launch \
    --compartment-id "$TENANCY" \
    --availability-domain "$AD" \
    --shape "VM.Standard.A1.Flex" \
    --shape-config "{\"ocpus\":$OCPUS,\"memoryInGBs\":$MEM_GB}" \
    --subnet-id "$SUBNET" \
    --assign-public-ip true \
    --image-id "$IMAGE" \
    --boot-volume-size-in-gbs "$BOOT_GB" \
    --display-name "$NAME" \
    --ssh-authorized-keys-file "$SSH_PUB" \
    --wait-for-state RUNNING \
    2>&1)
  rc=$?

  if [ $rc -eq 0 ]; then
    echo "[$ts] try #$i: LAUNCHED ✅"
    echo "$out" > /Users/mo/Developer/Personal/AnywhereCode/infra/oci-launch-result.json
    iid=$(echo "$out" | grep -m1 '"id"' | sed -E 's/.*"(ocid1\.instance[^"]+)".*/\1/')
    # Public IP lives on the VNIC, not the launch payload — fetch it.
    vnic=$(oci compute instance list-vnics --instance-id "$iid" --query "data[0].\"public-ip\"" --raw-output 2>/dev/null)
    echo "[$ts] instance=$iid  PUBLIC_IP=$vnic"
    echo "$vnic" > /Users/mo/Developer/Personal/AnywhereCode/infra/oci-public-ip.txt
    echo "NEXT: IP=$vnic ./infra/deploy.sh"
    break
  fi

  if echo "$out" | grep -qi "capacity"; then
    echo "[$ts] try #$i: out of capacity, retry in 60s"
  else
    echo "[$ts] try #$i: OTHER ERROR rc=$rc:"
    echo "$out" | tail -5
    echo "[$ts] stopping — fix above and rerun"
    break
  fi
  sleep 60
done
