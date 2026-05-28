# Dev parity for the pi kiosk.
#
# Spins up an x86 Debian Bookworm VM and provisions it with the SAME Ansible
# playbook the pi runs. Because the kiosk app is a web app, Chromium renders
# identically here and on the pi, so devs can test/debug the app on any OS
# (Windows included) without touching hardware.
#
# Note: VirtualBox has no real DRM/GPU seat, so the on-screen cage compositor
# is NOT started in the VM (kiosk_start_compositor=false). The playbook still
# installs and validates everything end-to-end. To eyeball the actual web app
# inside the VM, open the GUI and run:  /usr/local/bin/kiosk-launch.sh
Vagrant.configure("2") do |config|
  config.vm.box = "debian/bookworm64"
  config.vm.box_version = ">= 12.0.0"
  config.vm.hostname = "pi-kiosk-dev"

  # Browse the full app stack (nginx + API + DB) from the host at localhost:8080.
  config.vm.network "forwarded_port", guest: 80, host: 8080

  config.vm.provider "virtualbox" do |vb|
    vb.gui    = true          # show a window so you can see Chromium if you launch it
    vb.memory = 2048
    vb.cpus   = 2
  end

  # Ansible runs INSIDE the VM (ansible_local), so Windows hosts don't need a
  # native Ansible control node — identical execution path to the pi.
  config.vm.provision "ansible_local" do |ansible|
    ansible.playbook         = "ansible/site.yml"
    ansible.provisioning_path = "/vagrant"
    ansible.install_mode     = "default"
    ansible.inventory_path   = "ansible/inventory/localhost.yml"
    ansible.limit            = "localhost"
    ansible.extra_vars = {
      kiosk_start_compositor: false
    }
  end
end
