# Linux build/deployment parity for PiTV. The VM serves the phone companion at
# localhost:8080 and compiles the real Qt/GStreamer binary. Hardware decoding and
# HDMI hotplug must be verified on the Pi; an offscreen smoke test runs in the VM.
Vagrant.configure("2") do |config|
  config.vm.box = "debian/bookworm64"
  config.vm.box_version = ">= 12.0.0"
  config.vm.hostname = "pi-kiosk-dev"
  config.vm.network "forwarded_port", guest: 80, host: 8080
  config.vm.provider "virtualbox" do |vb|
    vb.gui = false
    vb.memory = 2048
    vb.cpus = 2
  end
  config.vm.provision "ansible_local" do |ansible|
    ansible.playbook = "ansible/site.yml"
    ansible.provisioning_path = "/vagrant"
    ansible.install_mode = "default"
    ansible.inventory_path = "ansible/inventory/localhost.yml"
    ansible.limit = "localhost"
    ansible.extra_vars = { kiosk_start_compositor: false }
  end
end
