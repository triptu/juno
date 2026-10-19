# Shared by the SSH health probe and host admission. A physical core is named
# by its lowest sibling CPU, not the package-local (and sometimes sparse) core_id.
expand_cpu_list() {
  local part first last cpu
  [[ "$1" =~ ^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$ ]] || return 1
  local parts
  IFS=, read -r -a parts <<< "$1"
  for part in "${parts[@]}"; do
    first=${part%-*}; last=${part#*-}
    [[ "$first" = 0 || "$first" != 0* ]] || return 1
    [[ "$last" = 0 || "$last" != 0* ]] || return 1
    (( first <= last && last < 65536 )) || return 1
    for ((cpu=first; cpu<=last; cpu++)); do echo "$cpu"; done
  done
}

runner_capacity() {
  local config=$1 topology=${2:-/sys/devices/system/cpu} ids id cpu siblings expanded representative seen='' online peer
  capacity=$(cat "$config") || return 1
  pinned=0
  core_ids=(); core_cpus=()
  if [[ "$capacity" =~ ^[0-9]+$ ]]; then
    [[ "$capacity" =~ ^[1-9][0-9]*$ ]] || return 1
    (( capacity <= $(getconf _NPROCESSORS_ONLN) )) || return 1
    return 0
  fi
  ids=$(expand_cpu_list "$capacity") || return 1
  online=$(expand_cpu_list "$(cat "$topology/online")") || return 1
  while read -r id; do
    [[ " $seen " != *" $id "* ]] || return 1
    seen="$seen $id"
    expanded=$(expand_cpu_list "$(cat "$topology/cpu$id/topology/thread_siblings_list")") || return 1
    representative=${expanded%%$'\n'*}
    [ "$representative" = "$id" ] || return 1
    siblings=$(paste -sd, - <<< "$expanded")
    while read -r cpu; do
      grep -Fxq "$cpu" <<< "$online" || return 1
      peer=$(expand_cpu_list "$(cat "$topology/cpu$cpu/topology/thread_siblings_list")") || return 1
      [ "$peer" = "$expanded" ] || return 1
    done <<< "$expanded"
    core_ids+=("$id"); core_cpus+=("$siblings")
  done < <(sort -n <<< "$ids")
  capacity=${#core_ids[@]}
  (( capacity > 0 )) || return 1
  pinned=1
}

# Prefer a consecutive run; fall back to the lowest free IDs if fragmented.
runner_allocate() {
  local occupied=$1 needed=$2 i id previous=-2 consecutive=0
  local free=() adjacent=()
  for ((i=0; i<${#core_ids[@]}; i++)); do
    id=${core_ids[i]}
    if [[ ",$occupied," = *",$id,"* ]]; then consecutive=0; adjacent=(); continue; fi
    free+=("$i")
    if (( id != previous + 1 )); then consecutive=0; adjacent=(); fi
    adjacent+=("$i"); consecutive=$((consecutive + 1)); previous=$id
    if (( consecutive == needed )); then free=("${adjacent[@]}"); break; fi
  done
  (( ${#free[@]} >= needed )) || return 1
  allocated_cores=''; allocated_cpus=''
  for ((i=0; i<needed; i++)); do
    allocated_cores+="${allocated_cores:+,}${core_ids[${free[i]}]}"
    allocated_cpus+="${allocated_cpus:+,}${core_cpus[${free[i]}]}"
  done
  allocated_threads=$(expand_cpu_list "$allocated_cpus" | wc -l)
  allocated_threads=$((allocated_threads))
}
