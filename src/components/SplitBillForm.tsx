import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

import { toast } from "sonner";
import { formatRupiah, parseRupiah } from "@/lib/currency";
import { Plus, Trash2, Calculator, Users, Camera } from "lucide-react";
import ReceiptScanner from "./ReceiptScanner";

interface Item {
  id: string;
  name: string;
  price: number;
  quantity: number;
  category: string;
  assignedTo: string[];
}

interface Participant {
  id: string;
  name: string;
}

export default function SplitBillForm({ userId }: { userId: string }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [tax, setTax] = useState("");
  const [service, setService] = useState("");
  const [tip, setTip] = useState("");
  const [loading, setLoading] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // New item form
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemQuantity, setNewItemQuantity] = useState("1");
  const [selectedOwner, setSelectedOwner] = useState("");

  // New participant
  const [newParticipantName, setNewParticipantName] = useState("");

  const addItem = () => {
    if (!newItemName.trim()) {
      alert("Nama item tidak boleh kosong!");
      return;
    }
    if (!newItemPrice.trim() || parseRupiah(newItemPrice) <= 0) {
      alert("Harga harus lebih dari 0!");
      return;
    }
    if (!selectedOwner) {
      alert("Pilih pemilik item!");
      return;
    }

    const newItem: Item = {
      id: Date.now().toString(),
      name: newItemName,
      price: parseRupiah(newItemPrice),
      quantity: parseInt(newItemQuantity) || 1,
      category: "Lainnya", // Default category
      assignedTo: [selectedOwner],
    };

    setItems([...items, newItem]);
    setNewItemName("");
    setNewItemPrice("");
    setNewItemQuantity("1");
    setSelectedOwner("");
    toast.success("Item ditambahkan");
  };

  const removeItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id));
    toast.success("Item dihapus");
  };

  const addParticipant = () => {
    if (!newParticipantName.trim()) {
      alert("Nama peserta tidak boleh kosong!");
      return;
    }
    if (participants.length >= 10) {
      alert("Maksimal 10 peserta!");
      return;
    }
    if (participants.some((p) => p.name.toLowerCase() === newParticipantName.toLowerCase())) {
      alert("Nama peserta sudah ada!");
      return;
    }

    const newParticipant: Participant = {
      id: Date.now().toString(),
      name: newParticipantName,
    };

    setParticipants([...participants, newParticipant]);
    setNewParticipantName("");
    toast.success("Peserta ditambahkan");
  };

  const removeParticipant = (id: string) => {
    setParticipants(participants.filter((p) => p.id !== id));
    // Remove assignments
    setItems(items.map((item) => ({
      ...item,
      assignedTo: item.assignedTo.filter((pId) => pId !== id),
    })));
    toast.success("Peserta dihapus");
  };


  const calculateSplit = () => {
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const taxAmount = parseRupiah(tax);
    const serviceAmount = parseRupiah(service);
    const tipAmount = parseRupiah(tip);
    const additionalCosts = taxAmount + serviceAmount + tipAmount;
    const additionalPerPerson = participants.length > 0 ? additionalCosts / participants.length : 0;

    const participantTotals: Record<string, number> = {};

    participants.forEach((p) => {
      participantTotals[p.id] = additionalPerPerson;
    });

    items.forEach((item) => {
      if (item.assignedTo.length > 0) {
        const pricePerPerson = (item.price * item.quantity) / item.assignedTo.length;
        item.assignedTo.forEach((pId) => {
          participantTotals[pId] = (participantTotals[pId] || 0) + pricePerPerson;
        });
      }
    });

    return {
      subtotal,
      tax: taxAmount,
      service: serviceAmount,
      tip: tipAmount,
      total: subtotal + additionalCosts,
      participantTotals,
    };
  };

  const handleSave = async () => {
    if (!title.trim()) {
      alert("Judul tidak boleh kosong!");
      return;
    }
    if (items.length === 0) {
      alert("Tambahkan minimal 1 item!");
      return;
    }
    if (participants.length < 2) {
      alert("Tambahkan minimal 2 peserta!");
      return;
    }

    // Check if all items are assigned
    const unassignedItems = items.filter((item) => item.assignedTo.length === 0);
    if (unassignedItems.length > 0) {
      alert(`Item berikut belum diassign: ${unassignedItems.map((i) => i.name).join(", ")}`);
      return;
    }

    setLoading(true);
    try {
      const calculation = calculateSplit();

      // Create transaction
      const { data: transaction, error: transactionError } = await supabase
        .from("transactions")
        .insert({
          user_id: userId,
          title,
          description,
          total_amount: calculation.total,
          tax_amount: calculation.tax,
          service_amount: calculation.service,
          tip_amount: calculation.tip,
        })
        .select()
        .single();

      if (transactionError) throw transactionError;

      // Create items
      const { data: createdItems, error: itemsError } = await supabase
        .from("transaction_items")
        .insert(
          items.map((item) => ({
            transaction_id: transaction.id,
            item_name: item.name,
            item_price: item.price,
            quantity: item.quantity,
            category: item.category,
          }))
        )
        .select();

      if (itemsError) throw itemsError;

      // Create participants
      const { data: createdParticipants, error: participantsError } = await supabase
        .from("transaction_participants")
        .insert(
          participants.map((p) => ({
            transaction_id: transaction.id,
            participant_name: p.name,
            total_amount: calculation.participantTotals[p.id] || 0,
          }))
        )
        .select();

      if (participantsError) throw participantsError;

      // Create assignments
      const assignments: any[] = [];
      items.forEach((item, index) => {
        const createdItem = createdItems[index];
        item.assignedTo.forEach((participantId) => {
          const participant = createdParticipants.find(
            (cp) => cp.participant_name === participants.find((p) => p.id === participantId)?.name
          );
          if (participant) {
            assignments.push({
              item_id: createdItem.id,
              participant_id: participant.id,
            });
          }
        });
      });

      const { error: assignmentsError } = await supabase
        .from("item_assignments")
        .insert(assignments);

      if (assignmentsError) throw assignmentsError;

      toast.success("Transaksi berhasil disimpan!");
      
      // Reset form
      setTitle("");
      setDescription("");
      setItems([]);
      setParticipants([]);
      setTax("");
      setService("");
      setTip("");
    } catch (error: any) {
      console.error("Error saving transaction:", error);
      toast.error(error.message || "Gagal menyimpan transaksi");
      alert(error.message || "Gagal menyimpan transaksi");
    } finally {
      setLoading(false);
    }
  };

  const calculation = calculateSplit();

  const handleScannedItems = (scannedItems: any[]) => {
    const newItems: Item[] = scannedItems.map((item) => ({
      id: Date.now().toString() + Math.random(),
      name: item.name,
      price: item.price,
      quantity: item.quantity || 1,
      category: "Makanan",
      assignedTo: [],
    }));
    setItems([...items, ...newItems]);
    setShowScanner(false);
    toast.success(`${newItems.length} item ditambahkan dari scan`);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left Column - Form */}
      <div className="space-y-6">
        {/* Transaction Info */}
        <Card className="shadow-medium">
          <CardHeader>
            <CardTitle>Informasi Transaksi</CardTitle>
            <CardDescription>Detail tagihan yang akan dibagi</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="title">Judul *</Label>
              <Input
                id="title"
                placeholder="Makan di Restoran XYZ"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="description">Deskripsi</Label>
              <Textarea
                id="description"
                placeholder="Catatan tambahan..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <Card className="shadow-medium">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Item Pengeluaran</CardTitle>
                <CardDescription>Tambah item manual atau scan struk</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowScanner(true)}
              >
                <Camera className="mr-2 h-4 w-4" />
                Scan Struk
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Nama Item *</Label>
                  <Input
                    placeholder="Nasi Goreng"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Harga (Rp) *</Label>
                  <Input
                    placeholder="50000"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Jumlah</Label>
                  <Input
                    type="number"
                    min="1"
                    value={newItemQuantity}
                    onChange={(e) => setNewItemQuantity(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Nama Pemilik *</Label>
                  <Select value={selectedOwner} onValueChange={setSelectedOwner}>
                    <SelectTrigger className="bg-popover">
                      <SelectValue placeholder="Pilih pemilik" />
                    </SelectTrigger>
                    <SelectContent className="bg-popover z-50">
                      {participants.length === 0 ? (
                        <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                          Tambahkan peserta terlebih dahulu
                        </div>
                      ) : (
                        participants.map((participant) => (
                          <SelectItem key={participant.id} value={participant.id}>
                            {participant.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={addItem} className="w-full" disabled={participants.length === 0}>
                <Plus className="mr-2 h-4 w-4" />
                Tambah Item
              </Button>
            </div>

            {items.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  {items.map((item) => {
                    const ownerName = participants.find(p => p.id === item.assignedTo[0])?.name || "Unknown";
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{item.name}</span>
                            <Badge variant="secondary" className="text-xs">
                              {ownerName}
                            </Badge>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatRupiah(item.price)} × {item.quantity} = {formatRupiah(item.price * item.quantity)}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(item.id)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Additional Costs */}
        <Card className="shadow-medium">
          <CardHeader>
            <CardTitle>Biaya Tambahan</CardTitle>
            <CardDescription>Akan dibagi rata ke semua peserta</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Pajak (Rp)</Label>
                <Input
                  placeholder="0"
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                />
              </div>
              <div>
                <Label>Service (Rp)</Label>
                <Input
                  placeholder="0"
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                />
              </div>
              <div>
                <Label>Tip (Rp)</Label>
                <Input
                  placeholder="0"
                  value={tip}
                  onChange={(e) => setTip(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right Column - Participants & Summary */}
      <div className="space-y-6">
        {/* Participants */}
        <Card className="shadow-medium">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Peserta
            </CardTitle>
            <CardDescription>Tambah 2-10 orang yang ikut patungan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Nama peserta"
                value={newParticipantName}
                onChange={(e) => setNewParticipantName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addParticipant()}
              />
              <Button onClick={addParticipant}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {participants.length > 0 && (
              <div className="space-y-2">
                {participants.map((participant) => (
                  <div
                    key={participant.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card"
                  >
                    <span className="font-medium">{participant.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeParticipant(participant.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>


        {/* Summary */}
        {participants.length > 0 && (
          <Card className="shadow-large border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Ringkasan Pembagian
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal Item:</span>
                  <span className="font-medium">{formatRupiah(calculation.subtotal)}</span>
                </div>
                {calculation.tax > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Pajak:</span>
                    <span>{formatRupiah(calculation.tax)}</span>
                  </div>
                )}
                {calculation.service > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Service:</span>
                    <span>{formatRupiah(calculation.service)}</span>
                  </div>
                )}
                {calculation.tip > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tip:</span>
                    <span>{formatRupiah(calculation.tip)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between font-bold text-lg">
                  <span>Total:</span>
                  <span className="text-primary">{formatRupiah(calculation.total)}</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="font-semibold text-sm mb-3">Pembagian per Orang:</div>
                {participants.map((participant) => (
                  <div
                    key={participant.id}
                    className="flex justify-between p-3 rounded-lg bg-accent/10"
                  >
                    <span className="font-medium">{participant.name}</span>
                    <span className="font-bold text-primary">
                      {formatRupiah(calculation.participantTotals[participant.id] || 0)}
                    </span>
                  </div>
                ))}
              </div>

              <Button
                onClick={handleSave}
                disabled={loading || items.length === 0 || participants.length < 2}
                className="w-full"
                size="lg"
              >
                {loading ? "Menyimpan..." : "Simpan Transaksi"}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {showScanner && (
        <ReceiptScanner
          onClose={() => setShowScanner(false)}
          onScanComplete={handleScannedItems}
        />
      )}
    </div>
  );
}
