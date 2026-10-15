# Linux build/deployment parity for PiTV. The VirtualBox window is the TV: the
# native app runs full screen on a plain X server, reading its QML straight from
# the shared repo so UI edits only need an app restart. The phone companion is at
# localhost:8080. Graphics and video decoding are software here; hardware decode,
# HDMI and Pi performance must be verified on the Pi.
Vagrant.configure("2") do |config|
  config.vm.box = "debian/bookworm64"
  config.vm.box_version = ">= 12.0.0"
  config.vm.hostname = "pi-kiosk-dev"
  config.vm.network "forwarded_port", guest: 80, host: 8080
  config.vm.provider "virtualbox" do |vb|
    vb.gui = true
    vb.memory = 4096
    vb.cpus = 4
    vb.customize ["modifyvm", :id, "--graphicscontroller", "vmsvga", "--vram", "128",
                  "--audio-enabled", "on", "--audio-driver", "default", "--audio-controller", "hda",
                  "--audio-out", "on", "--audio-in", "off"]
  end
  config.vm.provision "ansible_local" do |ansible|
    ansible.playbook = "ansible/site.yml"
    ansible.provisioning_path = "/vagrant"
    ansible.install_mode = "default"
    ansible.inventory_path = "ansible/inventory/localhost.yml"
    ansible.limit = "localhost"
    ansible.extra_vars = { kiosk_display: "xorg", kiosk_qml_dir: "/vagrant/native/qml", kiosk_self_update: false }
  end
end
